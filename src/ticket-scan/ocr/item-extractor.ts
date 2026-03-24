import { Injectable, Logger } from '@nestjs/common';
import { EXCLUDE_PATTERNS, TOTAL_PATTERNS, SECTION_PATTERNS } from './ocr.constants';
import { ParsedItem } from './ocr.types';

@Injectable()
export class ItemExtractor {
  private readonly logger = new Logger(ItemExtractor.name);

  // ─── Expresiones regulares de formatos de artículos ──────────────────────

  // Prefijo de código de barras: 10-13 dígitos al inicio
  private readonly barcodeRe = /^\d{10,13}\s+/;
  private readonly hasBarcodeStart = /^\d{10,13}(?:\s|$)/;

  // Formato Walmart: "NOMBRE  PRECIO_UNIT x CANT  TOTAL[T/C/A/M]"
  private readonly itemWithQtyRe =
    /^(.+?)\s{2,}(\d+\.?\d*)\s+[xX×]\s+(\d+)\s+\$?\s*(\d+\.?\d*)[TCAM]?\s*$/;

  // Formato simple: "NOMBRE  TOTAL[T/C/A/M]"  (2+ espacios antes del precio)
  private readonly itemSimpleRe =
    /^(.+?)\s{2,}\$?\s*(\d+\.?\d*)[TCAM]?\s*$/;

  // Línea de continuación con qty: "PRECIO_UNIT x CANT  TOTAL[T/C/A/M]"
  private readonly contWithQtyRe =
    /^\$?\s*(\d+\.?\d*)\s+[xX×]\s+(\d+)\s+\$?\s*(\d+\.?\d*)[TCAM]?\s*$/;

  // Línea de continuación qty sin total: "PRECIO_UNIT x CANT" (total en línea aparte)
  private readonly contQtyOnlyRe =
    /^\$?\s*(\d+\.?\d*)\s+[xX×]\s+(\d+)\s*$/;

  // Línea de continuación solo precio: "$?TOTAL[T/C/A/M]"
  private readonly contPriceRe =
    /^\$?\s*(\d+\.?\d*)[TCAM]?\s*$/;

  // Restaurante: "QTY CODE NOMBRE   PRECIO"
  private readonly restaurantItemRe =
    /^(\d{1,2})\s+([A-Z]{1,3})\s+(.+?)\s{2,}(\d+\.?\d*)\s*$/;

  // Sub-item combo sin precio: "QTY CODE NOMBRE"
  private readonly restaurantSubRe =
    /^(\d{1,2})\s+([A-Z]{1,3})\s+(.{2,})\s*$/;

  // Fallback: "NOMBRE PRECIO.CC[T/C/A/M]" (1 espacio + 2 decimales)
  private readonly m2bRe =
    /^(.+?)\s+\$?\s*(\d+\.\d{2})[TCAM]?\s*$/;

  /**
   * Extrae artículos del texto OCR.
   * @param lines Líneas ya pre-procesadas (split + trim + filter)
   * @param defaultCategory Categoría por defecto (de la tienda detectada)
   */
  extract(lines: string[], defaultCategory?: string): ParsedItem[] {
    const items: ParsedItem[] = [];
    let currentCategory: string | undefined = defaultCategory;
    let pendingName: string | null = null;
    let lastItemIsRestaurant = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length < 2) { pendingName = null; continue; }

      // Separadores → limpiar nombre pendiente
      if (/^[-=*\.★]{3,}/.test(line)) {
        pendingName = null;
        lastItemIsRestaurant = false;
        continue;
      }

      // ¿Es encabezado de sección?
      const secMatch = SECTION_PATTERNS.find((s) => s.pattern.test(line));
      if (secMatch) {
        currentCategory = secMatch.categoria;
        pendingName = null;
        lastItemIsRestaurant = false;
        continue;
      }

      // Encabezado de sección sin categoría conocida (ej. "JARDINERIA-----")
      if (/^[A-ZÁÉÍÓÚÑ\s]{4,}[-─]{3,}/.test(line) || /^[A-ZÁÉÍÓÚÑ\s]{4,}\s*-{3,}/.test(line)) {
        pendingName = null;
        lastItemIsRestaurant = false;
        continue;
      }

      // Excluir líneas de pago/referencia/dirección
      if (EXCLUDE_PATTERNS.some((r) => r.test(line))) {
        this.logger.debug(`[ITEMS] EXCLUIDO: "${line}"`);
        pendingName = null;
        lastItemIsRestaurant = false;
        continue;
      }

      // Excluir líneas de totales
      if (TOTAL_PATTERNS.some((r) => r.test(line))) {
        this.logger.debug(`[ITEMS] TOTAL-LINE: "${line}"`);
        pendingName = null;
        lastItemIsRestaurant = false;
        continue;
      }

      // ─── ¿Hay nombre pendiente? Intentar como línea de continuación ──────
      if (pendingName) {
        // contWithQtyRe: "45.00 x 2  90.00T"
        const m = line.match(this.contWithQtyRe);
        if (m) {
          const unitPrice = this.parseAmount(m[1]);
          const qty = parseInt(m[2], 10);
          const subtotal = this.parseAmount(m[3]);
          if (subtotal > 0 && subtotal <= 99_999) {
            items.push(this.makeItem(pendingName, qty, unitPrice, subtotal, currentCategory));
            this.logger.debug(`[ITEMS] ITEM(qty): "${pendingName}" qty=${qty} sub=${subtotal}`);
          }
          pendingName = null;
          continue;
        }

        // contQtyOnlyRe: "45.00 x 2" (Walmart: total en línea aparte)
        const mq = line.match(this.contQtyOnlyRe);
        if (mq) {
          const unitPrice = this.parseAmount(mq[1]);
          const qty = parseInt(mq[2], 10);
          const subtotal = Math.round(unitPrice * qty * 100) / 100;
          if (subtotal > 0 && subtotal <= 99_999) {
            items.push(this.makeItem(pendingName, qty, unitPrice, subtotal, currentCategory));
            this.logger.debug(`[ITEMS] ITEM(qty-calc): "${pendingName}" qty=${qty} unit=${unitPrice} sub=${subtotal}`);
          }
          pendingName = null;
          continue;
        }

        // contPriceRe: "90.00T"
        const mp = line.match(this.contPriceRe);
        if (mp) {
          const subtotal = this.parseAmount(mp[1]);
          if (subtotal > 0 && subtotal <= 99_999) {
            items.push(this.makeItem(pendingName, 1, subtotal, subtotal, currentCategory));
            this.logger.debug(`[ITEMS] ITEM(price): "${pendingName}" sub=${subtotal}`);
          }
          pendingName = null;
          continue;
        }

        pendingName = null; // la siguiente línea no fue continuación
      }

      // ─── Parsear línea de artículo ────────────────────────────────────────
      const cleanLine = line.replace(this.barcodeRe, '');

      // Formato 1: "NOMBRE  PRECIO_UNIT x CANT  TOTAL[T/C/A/M]"
      const m1 = cleanLine.match(this.itemWithQtyRe);
      if (m1) {
        const nombre = m1[1].trim();
        const unitPrice = this.parseAmount(m1[2]);
        const qty = parseInt(m1[3], 10);
        const subtotal = this.parseAmount(m1[4]);
        if (this.isValidItemName(nombre) && subtotal > 0 && subtotal <= 99_999) {
          items.push(this.makeItem(nombre, qty, unitPrice, subtotal, currentCategory));
          this.logger.debug(`[ITEMS] ITEM(qty): "${nombre}" qty=${qty} sub=${subtotal}`);
          lastItemIsRestaurant = false;
          continue;
        }
      }

      // Formato restaurante: "3 CB Doble Western   768.00"
      const mr = cleanLine.match(this.restaurantItemRe);
      if (mr) {
        const qty = parseInt(mr[1], 10);
        const nombre = mr[3].trim();
        const subtotal = this.parseAmount(mr[4]);
        if (this.isValidItemName(nombre) && subtotal > 0 && subtotal <= 99_999) {
          items.push(this.makeItem(
            nombre, qty,
            Math.round((subtotal / qty) * 100) / 100,
            subtotal, currentCategory,
          ));
          this.logger.debug(`[ITEMS] ITEM(rest): "${nombre}" qty=${qty} sub=${subtotal}`);
          lastItemIsRestaurant = true;
          continue;
        }
      }

      // Formato 2: "NOMBRE  TOTAL[T/C/A/M]" (2+ espacios)
      const m2 = cleanLine.match(this.itemSimpleRe);
      if (m2) {
        const nombre = m2[1].trim();
        const subtotal = this.parseAmount(m2[2]);
        if (this.isValidItemName(nombre) && subtotal > 0 && subtotal <= 99_999) {
          items.push(this.makeItem(nombre, 1, subtotal, subtotal, currentCategory));
          this.logger.debug(`[ITEMS] ITEM(simple): "${nombre}" sub=${subtotal}`);
          lastItemIsRestaurant = false;
          continue;
        }
      }

      // Formato 2b: fallback "NOMBRE PRECIO.CC[T/C/A/M]" (1 espacio + 2 decimales)
      const m2b = cleanLine.match(this.m2bRe);
      if (m2b) {
        const nombre = m2b[1].trim();
        const subtotal = this.parseAmount(m2b[2]);
        if (this.isValidItemName(nombre) && subtotal > 0 && subtotal <= 99_999) {
          items.push(this.makeItem(nombre, 1, subtotal, subtotal, currentCategory));
          this.logger.debug(`[ITEMS] ITEM(loose): "${nombre}" sub=${subtotal}`);
          lastItemIsRestaurant = false;
          continue;
        }
      }

      // Sub-item de combo / modificador sin precio
      const msub = cleanLine.match(this.restaurantSubRe);
      if (msub) {
        const detalle = msub[3].trim();
        if (lastItemIsRestaurant && items.length > 0 && detalle.length > 1) {
          items[items.length - 1].detalles.push(detalle);
          this.logger.debug(`[ITEMS] DETALLE → "${detalle}" (item: "${items[items.length - 1].nombre}")`);
        } else {
          if (this.isValidItemName(detalle)) {
            pendingName = `${msub[1]} ${detalle}`;
            this.logger.debug(`[ITEMS] REST-PENDING: "${pendingName}"`);
          }
        }
        continue;
      }

      // Formato 3: Solo código de barras + nombre (precio en la siguiente línea)
      if (this.hasBarcodeStart.test(line)) {
        const nameOnly = line.replace(/^\d{10,13}\s*/, '').trim();
        if (nameOnly.length > 2 && this.isValidItemName(nameOnly)) {
          pendingName = nameOnly;
          this.logger.debug(`[ITEMS] PENDING-NAME: "${nameOnly}"`);
        } else {
          this.logger.debug(`[ITEMS] BARCODE-ONLY: "${line}"`);
        }
        continue;
      }

      // Formato 4: Línea de solo texto sin precio (Walmart: nombre en línea propia)
      if (
        !pendingName &&
        cleanLine.length >= 3 &&
        !/\d/.test(cleanLine) &&
        /[a-zA-ZáéíóúÁÉÍÓÚñÑ]{3,}/.test(cleanLine) &&
        this.isValidItemName(cleanLine)
      ) {
        pendingName = cleanLine.trim();
        this.logger.debug(`[ITEMS] PENDING-TEXT: "${cleanLine}"`);
        continue;
      }

      // Ningún formato coincidió
      this.logger.debug(`[ITEMS] NO-MATCH: "${line}"`);
    }

    this.logger.log(
      `[ITEMS] Extraídos (${items.length}): ${JSON.stringify(items.map((it) => `${it.nombre}×${it.cantidad}=$${it.subtotal}`))}`,
    );

    return items;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private makeItem(
    nombre: string,
    cantidad: number,
    precioUnitario: number,
    subtotal: number,
    categoria?: string,
  ): ParsedItem {
    return {
      nombre,
      cantidad,
      precioUnitario,
      subtotal,
      categoria: categoria ?? 'otros',
      confianza: 0,
      detalles: [],
    };
  }

  /** Valida que el nombre de un artículo sea meaningful */
  isValidItemName(name: string): boolean {
    if (!name || name.length < 2) return false;
    if (/^\d+\.?\d*$/.test(name)) return false;
    if (/^\d+\.?\d*\s*[xX×]/.test(name)) return false;
    if (/^[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]+$/.test(name)) return false;
    if (/\b(total|subtotal|iva|ieps|cambio|efectivo|tarjeta|importe|afiliaci[oó]n|autorizaci[oó]n|pagado|fin\s*combo)\b/i.test(name)) return false;
    return true;
  }

  parseAmount(str: string): number {
    return Number(str.replace(/,/g, '')) || 0;
  }
}
