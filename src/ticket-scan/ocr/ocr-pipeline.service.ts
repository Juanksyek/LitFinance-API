import { Injectable, Logger } from '@nestjs/common';
import { OcrOrchestrator } from './ocr-orchestrator.service';
import { StoreDetector } from './store-detector';
import { TicketClassifier } from './ticket-classifier';
import { ItemExtractor } from './item-extractor';
import { TotalsExtractor } from './totals-extractor';
import { DateExtractor } from './date-extractor';
import { PaymentExtractor } from './payment-extractor';
import { CandidateRanker } from './candidate-ranker';
import { TicketParseResult } from './ocr.types';

/**
 * Pipeline OCR completo:
 *   imagen → OCR multi-variante → preprocess → parse (tienda, fecha, items, totales, pago) → score → pick best
 */
@Injectable()
export class OcrPipeline {
  private readonly logger = new Logger(OcrPipeline.name);

  constructor(
    private readonly ocrOrchestrator: OcrOrchestrator,
    private readonly storeDetector: StoreDetector,
    private readonly ticketClassifier: TicketClassifier,
    private readonly itemExtractor: ItemExtractor,
    private readonly totalsExtractor: TotalsExtractor,
    private readonly dateExtractor: DateExtractor,
    private readonly paymentExtractor: PaymentExtractor,
    private readonly candidateRanker: CandidateRanker,
  ) {}

  /**
   * Ejecuta el pipeline completo: OCR → parse → score → best candidate.
   */
  async process(
    base64Image: string,
    mimeType?: string,
    clientOcrText?: string,
  ): Promise<TicketParseResult> {
    // 1. Obtener textos candidatos
    const rawTexts = await this.ocrOrchestrator.extractAll(
      base64Image,
      mimeType ?? 'image/jpeg',
      clientOcrText,
    );

    this.logger.log(`[PIPELINE] ${rawTexts.length} textos candidatos obtenidos`);

    if (rawTexts.length === 0) {
      this.logger.warn('[PIPELINE] No se obtuvo texto OCR de ninguna fuente');
      return this.candidateRanker.pickBest([]);
    }

    // 2. Parsear cada candidato
    const candidates = rawTexts.map((raw) => this.parseCandidate(raw));

    // 3. Elegir el mejor
    const best = this.candidateRanker.pickBest(candidates);
    this.logger.log(
      `[PIPELINE] Mejor candidato: score=${best.score} tienda="${best.tienda}" items=${best.items.length} total=${best.total}`,
    );

    return best;
  }

  /**
   * Parsea un texto OCR directamente (sin llamar al OCR — para cuando ya tenemos texto).
   */
  parseText(raw: string): TicketParseResult {
    return this.parseCandidate(raw);
  }

  /**
   * Pipeline interno: pre-procesado → extractores → resultado.
   */
  private parseCandidate(raw: string): TicketParseResult {
    const lines = this.preprocessLines(raw);
    const fullText = lines.join('\n');

    this.logger.log(
      `[OCR-PARSER] ═══ OCR TEXT RECIBIDO (${lines.length} líneas) ═══\n` +
      lines.map((l, i) => `  [${String(i).padStart(2, '0')}] ${l}`).join('\n'),
    );

    // Extraer componentes
    const { store, tienda, direccionTienda } = this.storeDetector.detect(lines);
    const tipoTicket = this.ticketClassifier.classify(store, lines);
    const fechaCompra = this.dateExtractor.extract(lines);
    const items = this.itemExtractor.extract(lines, store?.defaultCategory);
    const totals = this.totalsExtractor.extract(lines);
    const metodoPago = this.paymentExtractor.extract(fullText);

    // Reconciliar totales con fallbacks
    let { subtotal, total } = totals;
    const { iva, ieps, impuestos, descuentos } = totals;

    if (subtotal === 0 && items.length > 0) {
      subtotal = items.reduce((s, item) => s + item.subtotal, 0);
    }
    if (total === 0) total = subtotal + impuestos;
    if (total < subtotal) total = subtotal + impuestos;

    this.logger.log(
      `[OCR-PARSER] ─── TOTALES FINALES ─── total=${total} sub=${subtotal} iva=${iva} ieps=${ieps} imp=${impuestos} desc=${descuentos} items=${items.length}`,
    );

    return {
      rawText: raw,
      tienda: tienda.substring(0, 120),
      direccionTienda: direccionTienda.substring(0, 200),
      fechaCompra,
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      impuestos,
      iva,
      ieps,
      descuentos: Math.round(descuentos * 100) / 100,
      propina: 0,
      total: Math.round(total * 100) / 100,
      metodoPago,
      tipoTicket,
      score: 0,
      confidence: {
        tienda: 0, fechaCompra: 0, items: 0,
        subtotal: 0, impuestos: 0, total: 0, metodoPago: 0,
      },
      warnings: [],
    };
  }

  /**
   * Pre-procesado de líneas: split → expand tabs → expand barcodes → trim → filter
   */
  private preprocessLines(raw: string): string[] {
    const barcodeAnchor = /(?<!\d)(?=\d{10,13}(?!\d))/;
    const expandLine = (l: string): string[] => {
      if (l.length < 80) return [l];
      const parts = l.split(barcodeAnchor);
      return parts.length > 1 ? parts : [l];
    };

    return raw
      .split('\n')
      .flatMap((l) => l.split('\t'))
      .flatMap(expandLine)
      .map((l) => l.trim())
      .filter(Boolean);
  }
}
