import { Injectable, Logger } from '@nestjs/common';
import { ITicketFamilyExtractor } from './family-extractor.interface';
import { ParsedItem } from '../ocr.types';
import { EXCLUDE_PATTERNS, TOTAL_PATTERNS } from '../ocr.constants';

/**
 * Extractor genérico: fallback para tickets que no coinciden con ninguna familia conocida.
 * Usa todos los formatos disponibles (supermercado + restaurante) combinados.
 */
@Injectable()
export class GenericExtractor implements ITicketFamilyExtractor {
  private readonly logger = new Logger(GenericExtractor.name);
  readonly familyName = 'generic';
  readonly supportedKinds = ['farmacia', 'gasolinera', 'conveniencia', 'servicios', 'desconocido'];

  private readonly barcodeRe = /^\d{10,13}\s+/;
  private readonly hasBarcodeStart = /^\d{10,13}(?:\s|$)/;
  private readonly itemWithQtyRe = /^(.+?)\s{2,}(\d+\.?\d*)\s+[xX×]\s+(\d+)\s+\$?\s*(\d+\.?\d*)[TCAM]?\s*$/;
  private readonly itemSimpleRe = /^(.+?)\s{2,}\$?\s*(\d+\.?\d*)[TCAM]?\s*$/;
  private readonly contWithQtyRe = /^\$?\s*(\d+\.?\d*)\s+[xX×]\s+(\d+)\s+\$?\s*(\d+\.?\d*)[TCAM]?\s*$/;
  private readonly contPriceRe = /^\$?\s*(\d+\.?\d*)[TCAM]?\s*$/;
  private readonly m2bRe = /^(.+?)\s+\$?\s*(\d+\.\d{2})[TCAM]?\s*$/;
  private readonly restaurantItemRe = /^(\d{1,2})\s+([A-Z]{1,3})\s+(.+?)\s{2,}(\d+\.?\d*)\s*$/;

  extractItems(lines: string[], defaultCategory?: string): ParsedItem[] {
    const items: ParsedItem[] = [];
    let pendingName: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length < 2) { pendingName = null; continue; }
      if (/^[-=*\.★]{3,}/.test(line)) { pendingName = null; continue; }
      if (EXCLUDE_PATTERNS.some((r) => r.test(line))) { pendingName = null; continue; }
      if (TOTAL_PATTERNS.some((r) => r.test(line))) { pendingName = null; continue; }

      // Continuación
      if (pendingName) {
        const m = line.match(this.contWithQtyRe);
        if (m) {
          const subtotal = this.parseAmount(m[3]);
          if (subtotal > 0 && subtotal <= 99_999) {
            items.push(this.makeItem(pendingName, parseInt(m[2], 10), this.parseAmount(m[1]), subtotal, defaultCategory));
          }
          pendingName = null; continue;
        }
        const mp = line.match(this.contPriceRe);
        if (mp) {
          const subtotal = this.parseAmount(mp[1]);
          if (subtotal > 0 && subtotal <= 99_999) {
            items.push(this.makeItem(pendingName, 1, subtotal, subtotal, defaultCategory));
          }
          pendingName = null; continue;
        }
        pendingName = null;
      }

      const cleanLine = line.replace(this.barcodeRe, '');

      // Qty format
      const m1 = cleanLine.match(this.itemWithQtyRe);
      if (m1 && this.isValid(m1[1].trim())) {
        items.push(this.makeItem(m1[1].trim(), parseInt(m1[3], 10), this.parseAmount(m1[2]), this.parseAmount(m1[4]), defaultCategory));
        continue;
      }

      // Restaurant format
      const mr = cleanLine.match(this.restaurantItemRe);
      if (mr && this.isValid(mr[3].trim())) {
        const qty = parseInt(mr[1], 10);
        const sub = this.parseAmount(mr[4]);
        items.push(this.makeItem(mr[3].trim(), qty, Math.round((sub / qty) * 100) / 100, sub, defaultCategory));
        continue;
      }

      // Simple
      const m2 = cleanLine.match(this.itemSimpleRe);
      if (m2 && this.isValid(m2[1].trim())) {
        const sub = this.parseAmount(m2[2]);
        items.push(this.makeItem(m2[1].trim(), 1, sub, sub, defaultCategory));
        continue;
      }

      // Loose
      const m2b = cleanLine.match(this.m2bRe);
      if (m2b && this.isValid(m2b[1].trim())) {
        const sub = this.parseAmount(m2b[2]);
        items.push(this.makeItem(m2b[1].trim(), 1, sub, sub, defaultCategory));
        continue;
      }

      // Barcode pending
      if (this.hasBarcodeStart.test(line)) {
        const nameOnly = line.replace(/^\d{10,13}\s*/, '').trim();
        if (nameOnly.length > 2 && this.isValid(nameOnly)) pendingName = nameOnly;
        continue;
      }

      // Text-only pending
      if (!pendingName && cleanLine.length >= 3 && !/\d/.test(cleanLine) && /[a-zA-ZáéíóúÁÉÍÓÚñÑ]{3,}/.test(cleanLine) && this.isValid(cleanLine)) {
        pendingName = cleanLine.trim();
        continue;
      }
    }

    this.logger.log(`[GENERIC] Extraídos: ${items.length} items`);
    return items;
  }

  private makeItem(nombre: string, cantidad: number, precioUnitario: number, subtotal: number, categoria?: string): ParsedItem {
    return { nombre, cantidad, precioUnitario, subtotal, categoria: categoria ?? 'otros', confianza: 0, detalles: [] };
  }

  private isValid(name: string): boolean {
    if (!name || name.length < 2) return false;
    if (/^\d+\.?\d*$/.test(name)) return false;
    if (/^[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]+$/.test(name)) return false;
    if (/\b(total|subtotal|iva|ieps|cambio|efectivo|tarjeta|importe|afiliaci[oó]n|autorizaci[oó]n|pagado|fin\s*combo)\b/i.test(name)) return false;
    return true;
  }

  private parseAmount(str: string): number {
    return Number(str.replace(/,/g, '')) || 0;
  }
}
