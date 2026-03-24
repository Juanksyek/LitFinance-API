import { Injectable, Logger } from '@nestjs/common';
import { TicketParseResult, ParsedItem, TicketKind, FieldConfidence } from './ocr.types';

@Injectable()
export class CandidateRanker {
  private readonly logger = new Logger(CandidateRanker.name);

  /**
   * Puntúa un resultado parseado de un candidato OCR.
   * Más items, coherencia subtotal ≈ suma items, y campos llenos = mejor score.
   */
  score(result: TicketParseResult): TicketParseResult {
    const warnings: string[] = [];
    let score = 0;

    // ─── Items count ───────────────────────────────────────────────────────
    const itemCount = result.items.length;
    if (itemCount > 0) {
      score += Math.min(itemCount * 5, 50); // max 50 pts por items
    } else {
      warnings.push('No se detectaron artículos');
    }

    // ─── Coherencia: suma items ≈ subtotal ────────────────────────────────
    const itemsSum = result.items.reduce((s, it) => s + it.subtotal, 0);
    if (result.subtotal > 0 && itemsSum > 0) {
      const ratio = itemsSum / result.subtotal;
      if (ratio >= 0.9 && ratio <= 1.1) {
        score += 20; // excelente coherencia
      } else if (ratio >= 0.7 && ratio <= 1.3) {
        score += 10;
      } else {
        warnings.push(`Suma items ($${itemsSum.toFixed(2)}) difiere del subtotal ($${result.subtotal.toFixed(2)})`);
      }
    }

    // ─── Campo tienda ──────────────────────────────────────────────────────
    if (result.tienda && result.tienda !== 'Tienda desconocida') {
      score += 10;
    }

    // ─── Fecha ─────────────────────────────────────────────────────────────
    if (result.fechaCompra) {
      const d = new Date(result.fechaCompra);
      if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) {
        score += 5;
      }
    }

    // ─── Total > 0 ─────────────────────────────────────────────────────────
    if (result.total > 0) {
      score += 10;
    }

    // ─── Método de pago ────────────────────────────────────────────────────
    if (result.metodoPago) {
      score += 5;
    }

    // ─── Confianza por campo ───────────────────────────────────────────────
    const confidence: FieldConfidence = {
      tienda: result.tienda && result.tienda !== 'Tienda desconocida' ? 0.9 : 0.2,
      fechaCompra: result.fechaCompra ? 0.8 : 0.1,
      items: itemCount > 0 ? Math.min(0.9, 0.3 + itemCount * 0.1) : 0.0,
      subtotal: result.subtotal > 0 ? 0.8 : 0.1,
      impuestos: result.impuestos > 0 ? 0.7 : 0.3,
      total: result.total > 0 ? 0.9 : 0.1,
      metodoPago: result.metodoPago ? 0.8 : 0.1,
    };

    return { ...result, score, confidence, warnings };
  }

  /**
   * Elige el mejor candidato de un array de resultados parseados.
   * Si todos tienen score 0 (ningún item, ningún total), devuelve el primero.
   */
  pickBest(candidates: TicketParseResult[]): TicketParseResult {
    if (candidates.length === 0) {
      return this.emptyResult();
    }

    const scored = candidates.map((c) => this.score(c));
    scored.sort((a, b) => b.score - a.score);

    this.logger.log(
      `[RANKER] ${scored.length} candidatos — scores: [${scored.map((c) => c.score).join(', ')}]`,
    );

    return scored[0];
  }

  private emptyResult(): TicketParseResult {
    return {
      rawText: '',
      tienda: 'Tienda desconocida',
      direccionTienda: '',
      fechaCompra: new Date().toISOString(),
      items: [],
      subtotal: 0,
      impuestos: 0,
      iva: 0,
      ieps: 0,
      descuentos: 0,
      propina: 0,
      total: 0,
      metodoPago: '',
      tipoTicket: 'desconocido',
      score: 0,
      confidence: {
        tienda: 0, fechaCompra: 0, items: 0, subtotal: 0,
        impuestos: 0, total: 0, metodoPago: 0,
      },
      warnings: ['No se recibió texto OCR'],
    };
  }
}
