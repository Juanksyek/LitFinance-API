import { Injectable, Logger } from '@nestjs/common';
import { ITicketFamilyExtractor } from './family-extractor.interface';
import { ParsedItem } from '../ocr.types';
import { EXCLUDE_PATTERNS, TOTAL_PATTERNS } from '../ocr.constants';

/**
 * Extractor especializado para restaurantes (Carl's Jr, McDonald's, Burger King, etc.)
 *
 * Características de tickets de restaurante:
 *   - Formato: "QTY CODE NOMBRE   PRECIO"
 *   - Sub-items / modificadores sin precio (ingredientes de combo)
 *   - Separadores de combo: "--- FIN COMBO ---"
 *   - Propina / servicio de mesa
 *   - Nombre del mesero / comensal
 *   - Órdenes numeradas
 */
@Injectable()
export class RestaurantExtractor implements ITicketFamilyExtractor {
  private readonly logger = new Logger(RestaurantExtractor.name);
  readonly familyName = 'restaurant';
  readonly supportedKinds = ['restaurante'];

  // ─── Regex específicos de restaurante ──────────────────────────

  /** Formato: "3 CB Doble Western   768.00" */
  private readonly restaurantItemRe = /^(\d{1,2})\s+([A-Z]{1,3})\s+(.+?)\s{2,}(\d+\.?\d*)\s*$/;
  /** Sub-item combo sin precio: "1 CB Papas Medianas" */
  private readonly restaurantSubRe = /^(\d{1,2})\s+([A-Z]{1,3})\s+(.{2,})\s*$/;
  /** Formato simple para restaurantes: "NOMBRE  PRECIO" */
  private readonly simpleItemRe = /^(.+?)\s{2,}\$?\s*(\d+\.?\d*)\s*$/;
  /** Formato loose: "NOMBRE PRECIO.CC" */
  private readonly looseItemRe = /^(.+?)\s+\$?\s*(\d+\.\d{2})\s*$/;
  /** Propina explícita */
  private readonly propinaRe = /\b(propina|tip|servicio\s*mesa)\b/i;

  extractItems(lines: string[], defaultCategory?: string): ParsedItem[] {
    const items: ParsedItem[] = [];
    let lastItemIsRestaurant = false;
    const category = defaultCategory ?? 'restaurante';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length < 2) { lastItemIsRestaurant = false; continue; }

      // Separadores
      if (/^[-=*\.★]{3,}/.test(line)) { lastItemIsRestaurant = false; continue; }
      if (EXCLUDE_PATTERNS.some((r) => r.test(line))) { lastItemIsRestaurant = false; continue; }
      if (TOTAL_PATTERNS.some((r) => r.test(line))) { lastItemIsRestaurant = false; continue; }
      if (this.propinaRe.test(line)) continue;
      if (/\bfin\s*(de\s*)?combo\b/i.test(line)) { lastItemIsRestaurant = false; continue; }

      // Formato restaurant principal: "3 CB Doble Western   768.00"
      const mr = line.match(this.restaurantItemRe);
      if (mr) {
        const qty = parseInt(mr[1], 10);
        const nombre = mr[3].trim();
        const subtotal = this.parseAmount(mr[4]);
        if (this.isValidItemName(nombre) && subtotal > 0 && subtotal <= 99_999) {
          items.push({
            nombre,
            cantidad: qty,
            precioUnitario: Math.round((subtotal / qty) * 100) / 100,
            subtotal,
            categoria: category,
            confianza: 0,
            detalles: [],
          });
          lastItemIsRestaurant = true;
          continue;
        }
      }

      // Sub-item de combo (sin precio)
      const msub = line.match(this.restaurantSubRe);
      if (msub) {
        const detalle = msub[3].trim();
        if (lastItemIsRestaurant && items.length > 0 && detalle.length > 1) {
          items[items.length - 1].detalles.push(detalle);
        }
        continue;
      }

      // Formato simple: "Doble Western   256.00"
      const m2 = line.match(this.simpleItemRe);
      if (m2) {
        const nombre = m2[1].trim();
        const subtotal = this.parseAmount(m2[2]);
        if (this.isValidItemName(nombre) && subtotal > 0 && subtotal <= 99_999) {
          items.push({
            nombre, cantidad: 1, precioUnitario: subtotal, subtotal,
            categoria: category, confianza: 0, detalles: [],
          });
          lastItemIsRestaurant = true;
          continue;
        }
      }

      // Formato loose
      const ml = line.match(this.looseItemRe);
      if (ml) {
        const nombre = ml[1].trim();
        const subtotal = this.parseAmount(ml[2]);
        if (this.isValidItemName(nombre) && subtotal > 0 && subtotal <= 99_999) {
          items.push({
            nombre, cantidad: 1, precioUnitario: subtotal, subtotal,
            categoria: category, confianza: 0, detalles: [],
          });
          lastItemIsRestaurant = true;
          continue;
        }
      }
    }

    this.logger.log(`[RESTAURANT] Extraídos: ${items.length} items`);
    return items;
  }

  private isValidItemName(name: string): boolean {
    if (!name || name.length < 2) return false;
    if (/^\d+\.?\d*$/.test(name)) return false;
    if (/^[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]+$/.test(name)) return false;
    if (/\b(total|subtotal|iva|cambio|efectivo|tarjeta|importe|afiliaci[oó]n|autorizaci[oó]n|pagado)\b/i.test(name)) return false;
    return true;
  }

  private parseAmount(str: string): number {
    return Number(str.replace(/,/g, '')) || 0;
  }
}
