import { Injectable, Logger } from '@nestjs/common';
import { OcrOrchestrator } from './ocr-orchestrator.service';
import { StoreDetector } from './store-detector';
import { TicketClassifier } from './ticket-classifier';
import { ItemExtractor } from './item-extractor';
import { TotalsExtractor } from './totals-extractor';
import { DateExtractor } from './date-extractor';
import { PaymentExtractor } from './payment-extractor';
import { CandidateRanker } from './candidate-ranker';
import { ReconciliationService } from './reconciliation.service';
import { SupermarketExtractor } from './extractors/supermarket.extractor';
import { RestaurantExtractor } from './extractors/restaurant.extractor';
import { GenericExtractor } from './extractors/generic.extractor';
import { TicketParseResult, TicketKind } from './ocr.types';
import { OcrProviderResult } from './ocr-provider.interface';
import { TicketLearningService } from '../learning/ticket-learning.service';

/**
 * Pipeline OCR completo:
 *   imagen → preprocesamiento → OCR multi-proveedor → clasificar → extractor por familia
 *   → reconciliación contable → score → merge con datos estructurados → pick best
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
    private readonly reconciliation: ReconciliationService,
    private readonly supermarketExtractor: SupermarketExtractor,
    private readonly restaurantExtractor: RestaurantExtractor,
    private readonly genericExtractor: GenericExtractor,
    private readonly learningService: TicketLearningService,
  ) {}

  /**
   * Ejecuta el pipeline completo:
   *   imagen → preprocesar → OCR multi-proveedor → parse cada texto → score → merge → best
   *
   * Devuelve el mejor resultado + metadata para el dataset de entrenamiento.
   */
  async process(
    base64Image: string,
    mimeType?: string,
    clientOcrText?: string,
  ): Promise<{
    result: TicketParseResult;
    providerResults: OcrProviderResult[];
    extractorUsed: string;
    reviewLevel: string;
  }> {
    // 1. OCR multi-proveedor (incluye preprocesamiento de imagen)
    const { texts: rawTexts, providerResults } = await this.ocrOrchestrator.extractAll(
      base64Image,
      mimeType ?? 'image/jpeg',
      clientOcrText,
    );

    this.logger.log(
      `[PIPELINE] ${rawTexts.length} textos candidatos, ${providerResults.length} resultados de proveedores`,
    );

    if (rawTexts.length === 0 && providerResults.length === 0) {
      this.logger.warn('[PIPELINE] No se obtuvo texto OCR de ninguna fuente');
      return {
        result: this.candidateRanker.pickBest([]),
        providerResults: [],
        extractorUsed: 'none',
        reviewLevel: 'manual',
      };
    }

    // 2. Parsear cada texto candidato con extractores por familia
    const candidates: TicketParseResult[] = [];
    let bestExtractor = 'generic';

    for (const raw of rawTexts) {
      const { parsed, extractor } = await this.parseCandidateWithFamily(raw);
      candidates.push(parsed);
      if (parsed.items.length > 0) bestExtractor = extractor;
    }

    // 3. Elegir el mejor candidato por score
    let best = this.candidateRanker.pickBest(candidates);

    // 4. Merge con datos estructurados de proveedores (Azure receipt, etc.)
    best = this.reconciliation.mergeProviderResults(best, providerResults);

    // 5. Calcular nivel de revisión
    const reviewLevel = this.reconciliation.getReviewLevel(best.confidence);

    this.logger.log(
      `[PIPELINE] Mejor: score=${best.score} tienda="${best.tienda}" items=${best.items.length} total=${best.total} extractor=${bestExtractor} review=${reviewLevel}`,
    );

    return {
      result: best,
      providerResults,
      extractorUsed: bestExtractor,
      reviewLevel,
    };
  }

  /**
   * Parsea un texto OCR directamente (sin llamar al OCR — para cuando ya tenemos texto).
   */
  parseText(raw: string): Promise<TicketParseResult> {
    return this.parseCandidateWithFamily(raw).then(({ parsed }) =>
      this.reconciliation.reconcile(parsed),
    );
  }

  /**
   * Pipeline interno con selección de extractor por familia:
   *   preprocess → detectar tienda → clasificar → extractor específico → totales → reconciliar
   */
  private async parseCandidateWithFamily(raw: string): Promise<{
    parsed: TicketParseResult;
    extractor: string;
  }> {
    const lines = this.preprocessLines(raw);
    const fullText = lines.join('\n');

    this.logger.log(
      `[OCR-PARSER] ═══ OCR TEXT RECIBIDO (${lines.length} líneas) ═══\n` +
      lines.map((l, i) => `  [${String(i).padStart(2, '0')}] ${l}`).join('\n'),
    );

    // Extraer componentes base
    const { store, tienda, direccionTienda } = await this.storeDetector.detect(lines);
    const tipoTicket = this.ticketClassifier.classify(store, lines);
    const fechaCompra = this.dateExtractor.extract(lines);
    const totals = this.totalsExtractor.extract(lines);
    const metodoPago = this.paymentExtractor.extract(fullText);

    // ─── Consultar template aprendido para guiar extracción ─────
    let templateHintExtractor: string | null = null;
    const hints = await this.learningService.getTemplateHints(tienda);
    if (hints) {
      templateHintExtractor = hints.preferredExtractor;
      this.logger.log(
        `[OCR-PARSER] Template hints: extractor=${hints.preferredExtractor} formats=${hints.itemFormats.length} dateFormats=${hints.dateFormats.join(',')}`,
      );
    }

    // ─── Seleccionar extractor por familia ───────────────────────
    // Si hay template hint con extractor preferido, usarlo primero
    let items;
    let extractorName: string;

    const effectiveExtractor = templateHintExtractor || this.kindToExtractor(tipoTicket);

    if (effectiveExtractor === 'supermarket' || this.isSupermercadoKind(tipoTicket)) {
      items = this.supermarketExtractor.extractItems(lines, store?.defaultCategory);
      extractorName = 'supermarket';
    } else if (effectiveExtractor === 'restaurant' || tipoTicket === 'restaurante') {
      items = this.restaurantExtractor.extractItems(lines, store?.defaultCategory);
      extractorName = 'restaurant';

      // Fallback: si restaurante no sacó items, usar genérico
      if (items.length === 0) {
        items = this.genericExtractor.extractItems(lines, store?.defaultCategory);
        extractorName = 'generic(fallback-rest)';
      }
    } else {
      items = this.genericExtractor.extractItems(lines, store?.defaultCategory);
      extractorName = 'generic';
    }

    // Si el extractor específico falló, intentar con el genérico original
    if (items.length === 0 && extractorName !== 'generic') {
      const genericItems = this.itemExtractor.extract(lines, store?.defaultCategory);
      if (genericItems.length > items.length) {
        items = genericItems;
        extractorName = 'legacy-generic';
      }
    }

    this.logger.log(
      `[OCR-PARSER] Familia=${extractorName} Tipo=${tipoTicket} Items=${items.length}`,
    );

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
      parsed: {
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
      },
      extractor: extractorName,
    };
  }

  private isSupermercadoKind(kind: TicketKind): boolean {
    return kind === 'supermercado' || kind === 'departamental';
  }

  private kindToExtractor(kind: TicketKind): string {
    if (this.isSupermercadoKind(kind)) return 'supermarket';
    if (kind === 'restaurante') return 'restaurant';
    return 'generic';
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
