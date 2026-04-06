import { Injectable, Logger } from '@nestjs/common';
import { KNOWN_STORES } from './ocr.constants';
import { DetectedStore } from './ocr.types';
import { TicketLearningService } from '../learning/ticket-learning.service';

@Injectable()
export class StoreDetector {
  private readonly logger = new Logger(StoreDetector.name);

  constructor(private readonly learningService: TicketLearningService) {}

  /**
   * Busca el nombre de tienda en las primeras 12 líneas (header) y últimas 15 (footer).
   * Primero busca en KNOWN_STORES (hardcoded), luego en tiendas aprendidas.
   */
  async detect(lines: string[]): Promise<{
    store: DetectedStore | null;
    tienda: string;
    direccionTienda: string;
    learnedTemplateId?: string;
  }> {
    let store: DetectedStore | null = null;
    let learnedTemplateId: string | undefined;

    // 1. Buscar en header (primeras 12 líneas)
    const headerBlock = lines.slice(0, Math.min(12, lines.length)).join(' ');
    for (const entry of KNOWN_STORES) {
      if (entry.patterns.some((p) => p.test(headerBlock))) {
        store = { name: entry.name, defaultCategory: entry.defaultCategory };
        break;
      }
    }

    // 2. Buscar en footer (últimas 15 líneas)
    if (!store) {
      const footerBlock = lines.slice(Math.max(0, lines.length - 15)).join(' ');
      for (const entry of KNOWN_STORES) {
        if (entry.patterns.some((p) => p.test(footerBlock))) {
          store = { name: entry.name, defaultCategory: entry.defaultCategory };
          break;
        }
      }
    }

    // 3. Si no se encontró en KNOWN_STORES, buscar en tiendas aprendidas
    if (!store) {
      const learned = await this.learningService.findStoreByText(headerBlock);
      if (learned) {
        store = { name: learned.storeName, defaultCategory: learned.defaultCategory };
        learnedTemplateId = learned.templateId;
        this.logger.log(`[STORE] Tienda detectada por aprendizaje: "${learned.storeName}"`);
      }
    }

    // 4. Nombre de tienda
    let tienda = store?.name ?? 'Tienda desconocida';
    if (!store) {
      tienda = this.extractFallbackName(lines);
    }

    // 5. Dirección
    const direccionTienda = this.extractAddress(lines);

    this.logger.log(
      `[STORE] Detectada="${tienda}" KnownStore=${store?.name ?? '—'} Dir="${direccionTienda}"` +
      (learnedTemplateId ? ` (learned:${learnedTemplateId})` : ''),
    );

    return { store, tienda, direccionTienda, learnedTemplateId };
  }

  /** Extrae nombre de la primera línea que parezca un nombre de tienda */
  private extractFallbackName(lines: string[]): string {
    for (let idx = 0; idx < Math.min(8, lines.length); idx++) {
      const l = lines[idx];
      if (l.length < 3) continue;
      if (/^\d/.test(l)) continue;
      if (/^[-=*\.★─]{3,}/.test(l)) continue;
      if (/r\.?f\.?c\.?\b/i.test(l)) continue;
      if (/^s\.?\s*a\.?\s*de\s*c\.?\s*v/i.test(l)) continue;
      if (/^s\s+de\s+r\.?\s*l/i.test(l)) continue;
      if (/^(av|calle|blvd|col|c\.p)\./i.test(l)) continue;
      if (/^store|^sucursal|^tienda\s*#/i.test(l)) continue;
      if (/^local\s+/i.test(l)) continue;
      if (l.includes(':') && !/^[A-Z]{3,}/i.test(l)) continue;
      return l.replace(/[*★]+/g, '').trim().substring(0, 120);
    }
    return 'Tienda desconocida';
  }

  /** Busca una dirección en las primeras 10 líneas */
  private extractAddress(lines: string[]): string {
    for (let idx = 0; idx < Math.min(10, lines.length); idx++) {
      const l = lines[idx];
      if (/^(av\.?|calle|blvd\.?|carr\.?|prol\.?)\s/i.test(l)) {
        return l.substring(0, 200);
      }
    }
    return '';
  }
}
