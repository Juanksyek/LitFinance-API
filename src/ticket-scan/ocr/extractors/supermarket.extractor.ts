import { Injectable, Logger } from '@nestjs/common';
import { ITicketFamilyExtractor } from './family-extractor.interface';
import { ParsedItem } from '../ocr.types';
import { EXCLUDE_PATTERNS, TOTAL_PATTERNS, SECTION_PATTERNS } from '../ocr.constants';

/**
 * Extractor especializado para supermercados (Walmart, Soriana, Chedraui, HEB, etc.)
 *
 * Características de tickets de supermercado:
 *   - Secciones: ABARROTES, CARNES, LÁCTEOS, etc.
 *   - Códigos de barras (10-13 dígitos) + nombre en línea aparte
 *   - Formato qty: "NOMBRE  PRECIO x CANT  TOTAL[T/C/A/M]"
 *   - Líneas partidas: nombre en una línea, precio en la siguiente
 *   - IVA/IEPS por artículo con sufijos T (tasa 0), E (exento), C, A, M
 *   - Descuentos inline (AHORRO, REBAJA)
 */
@Injectable()
export class SupermarketExtractor implements ITicketFamilyExtractor {
  private readonly logger = new Logger(SupermarketExtractor.name);
  readonly familyName = 'supermarket';
  readonly supportedKinds = ['supermercado', 'departamental'];

  // ─── Regex específicos de supermercado ─────────────────────────

  private readonly barcodeRe = /^\d{10,13}\s+/;
  private readonly hasBarcodeStart = /^\d{10,13}(?:\s|$)/;
  private readonly itemWithQtyRe = /^(.+?)\s{2,}(\d+\.?\d*)\s+[xX×]\s+(\d+)\s+\$?\s*(\d+\.?\d*)[TCAM]?\s*$/;
  private readonly itemSimpleRe = /^(.+?)\s{2,}\$?\s*(\d+\.?\d*)[TCAM]?\s*$/;
  private readonly contWithQtyRe = /^\$?\s*(\d+\.?\d*)\s+[xX×]\s+(\d+)\s+\$?\s*(\d+\.?\d*)[TCAM]?\s*$/;
  private readonly contQtyOnlyRe = /^\$?\s*(\d+\.?\d*)\s+[xX×]\s+(\d+)\s*$/;
  private readonly contPriceRe = /^\$?\s*(\d+\.?\d*)[TCAM]?\s*$/;
  private readonly m2bRe = /^(.+?)\s+\$?\s*(\d+\.\d{2})[TCAM]?\s*$/;
  /** Línea de descuento inline Walmart */
  private readonly discountRe = /^(ahorro|rebaja|descuento|dto)/i;

  extractItems(lines: string[], defaultCategory?: string): ParsedItem[] {
    const items: ParsedItem[] = [];
    let currentCategory: string | undefined = defaultCategory;
    let pendingName: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length < 2) { pendingName = null; continue; }

      if (/^[-=*\.★]{3,}/.test(line)) { pendingName = null; continue; }

      // Sección
      const secMatch = SECTION_PATTERNS.find((s) => s.pattern.test(line));
      if (secMatch) { currentCategory = secMatch.categoria; pendingName = null; continue; }

      // Encabezado de sección tipo "JARDINERIA-----"
      if (/^[A-ZÁÉÍÓÚÑ\s]{4,}[-─]{3,}/.test(line) || /^[A-ZÁÉÍÓÚÑ\s]{4,}\s*-{3,}/.test(line)) {
        pendingName = null; continue;
      }

      if (EXCLUDE_PATTERNS.some((r) => r.test(line))) { pendingName = null; continue; }
      if (TOTAL_PATTERNS.some((r) => r.test(line))) { pendingName = null; continue; }

      // Descuentos inline → ignorar
      if (this.discountRe.test(line)) { continue; }

      // ─── Líneas de continuación ──────────────────────────────
      if (pendingName) {
        const m = line.match(this.contWithQtyRe);
        if (m) {
          const unitPrice = this.parseAmount(m[1]);
          const qty = parseInt(m[2], 10);
          const subtotal = this.parseAmount(m[3]);
          if (subtotal > 0 && subtotal <= 99_999) {
            items.push(this.makeItem(pendingName, qty, unitPrice, subtotal, currentCategory));
          }
          pendingName = null; continue;
        }

        const mq = line.match(this.contQtyOnlyRe);
        if (mq) {
          const unitPrice = this.parseAmount(mq[1]);
          const qty = parseInt(mq[2], 10);
          const subtotal = Math.round(unitPrice * qty * 100) / 100;
          if (subtotal > 0 && subtotal <= 99_999) {
            items.push(this.makeItem(pendingName, qty, unitPrice, subtotal, currentCategory));
          }
          pendingName = null; continue;
        }

        const mp = line.match(this.contPriceRe);
        if (mp) {
          const subtotal = this.parseAmount(mp[1]);
          if (subtotal > 0 && subtotal <= 99_999) {
            items.push(this.makeItem(pendingName, 1, subtotal, subtotal, currentCategory));
          }
          pendingName = null; continue;
        }

        pendingName = null;
      }

      // ─── Parsear línea de artículo ────────────────────────────
      const cleanLine = line.replace(this.barcodeRe, '');

      const m1 = cleanLine.match(this.itemWithQtyRe);
      if (m1) {
        const nombre = m1[1].trim();
        const unitPrice = this.parseAmount(m1[2]);
        const qty = parseInt(m1[3], 10);
        const subtotal = this.parseAmount(m1[4]);
        if (this.isValidItemName(nombre) && subtotal > 0 && subtotal <= 99_999) {
          items.push(this.makeItem(nombre, qty, unitPrice, subtotal, currentCategory));
          continue;
        }
      }

      const m2 = cleanLine.match(this.itemSimpleRe);
      if (m2) {
        const nombre = m2[1].trim();
        const subtotal = this.parseAmount(m2[2]);
        if (this.isValidItemName(nombre) && subtotal > 0 && subtotal <= 99_999) {
          items.push(this.makeItem(nombre, 1, subtotal, subtotal, currentCategory));
          continue;
        }
      }

      const m2b = cleanLine.match(this.m2bRe);
      if (m2b) {
        const nombre = m2b[1].trim();
        const subtotal = this.parseAmount(m2b[2]);
        if (this.isValidItemName(nombre) && subtotal > 0 && subtotal <= 99_999) {
          items.push(this.makeItem(nombre, 1, subtotal, subtotal, currentCategory));
          continue;
        }
      }

      // Código de barras + nombre
      if (this.hasBarcodeStart.test(line)) {
        const nameOnly = line.replace(/^\d{10,13}\s*/, '').trim();
        if (nameOnly.length > 2 && this.isValidItemName(nameOnly)) {
          pendingName = nameOnly;
        }
        continue;
      }

      // Línea de solo texto → pendiente
      if (
        !pendingName &&
        cleanLine.length >= 3 &&
        !/\d/.test(cleanLine) &&
        /[a-zA-ZáéíóúÁÉÍÓÚñÑ]{3,}/.test(cleanLine) &&
        this.isValidItemName(cleanLine)
      ) {
        pendingName = cleanLine.trim();
        continue;
      }
    }

    this.logger.log(`[SUPERMARKET] Extraídos: ${items.length} items`);
    return items;
  }

  private makeItem(nombre: string, cantidad: number, precioUnitario: number, subtotal: number, categoria?: string): ParsedItem {
    return { nombre, cantidad, precioUnitario, subtotal, categoria: categoria ?? 'otros', confianza: 0, detalles: [] };
  }

  private isValidItemName(name: string): boolean {
    if (!name || name.length < 2) return false;
    if (/^\d+\.?\d*$/.test(name)) return false;
    if (/^\d+\.?\d*\s*[xX×]/.test(name)) return false;
    if (/^[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]+$/.test(name)) return false;
    if (/\b(total|subtotal|iva|ieps|cambio|efectivo|tarjeta|importe|afiliaci[oó]n|autorizaci[oó]n|pagado|fin\s*combo)\b/i.test(name)) return false;
    return true;
  }

  private parseAmount(str: string): number {
    return Number(str.replace(/,/g, '')) || 0;
  }
}
