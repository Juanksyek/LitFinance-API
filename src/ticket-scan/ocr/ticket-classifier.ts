import { Injectable } from '@nestjs/common';
import { TICKET_KIND_HINTS } from './ocr.constants';
import { DetectedStore, TicketKind } from './ocr.types';

@Injectable()
export class TicketClassifier {
  /**
   * Clasifica el tipo de ticket basándose en la tienda detectada y el contenido del texto.
   */
  classify(store: DetectedStore | null, lines: string[]): TicketKind {
    // 1. Si la tienda conocida tiene categoría mapeada → convertir a TicketKind
    if (store) {
      const kind = this.categoryToKind(store.defaultCategory);
      if (kind !== 'desconocido') return kind;
    }

    // 2. Buscar pistas en el texto completo
    const fullText = lines.join(' ');
    for (const hint of TICKET_KIND_HINTS) {
      if (hint.patterns.some((p) => p.test(fullText))) {
        return hint.kind;
      }
    }

    return 'desconocido';
  }

  private categoryToKind(category: string): TicketKind {
    const map: Record<string, TicketKind> = {
      restaurante: 'restaurante',
      supermercado: 'supermercado',
      farmacia: 'farmacia',
      transporte: 'gasolinera',
      ropa: 'departamental',
      hogar: 'departamental',
      educacion: 'departamental',
      tecnologia: 'departamental',
      entretenimiento: 'departamental',
      alimentos: 'conveniencia',
      servicios: 'servicios',
    };
    return map[category] ?? 'desconocido';
  }
}
