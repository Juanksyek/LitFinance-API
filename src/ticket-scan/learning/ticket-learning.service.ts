import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TicketTemplate, TicketTemplateDocument } from './ticket-template.schema';
import { StructureAnalyzer, StructuralFingerprint } from './structure-analyzer';
import { TicketScan, TicketScanDocument } from '../schemas/ticket-scan.schema';

/**
 * Servicio de aprendizaje continuo de tickets — ROBUSTO.
 *
 * Características:
 *  1. Aprendizaje por corrección: analiza QUÉ campos corrigió el usuario (no solo si corrigió)
 *  2. Field-level accuracy: tracking de precisión por campo (tienda, fecha, total, subtotal, impuestos, items)
 *  3. Extractor performance: cuál extractor funciona mejor para cada tienda
 *  4. OCR source performance: cuál fuente OCR da mejores resultados por tienda
 *  5. Pattern decay: reduce confianza de formatos no usados recientemente
 *  6. Price column detection: aprende posición de columna de precios
 *  7. Correction history: mantiene las últimas 20 correcciones para análisis
 *  8. Anomaly detection: alerta cuando la accuracy decae significativamente
 *  9. Multi-line item awareness: detecta y trackea items multi-línea
 */

// Campos que rastreamos para accuracy
const TRACKED_FIELDS = ['tienda', 'fecha', 'total', 'subtotal', 'impuestos', 'items'] as const;

@Injectable()
export class TicketLearningService {
  private readonly logger = new Logger(TicketLearningService.name);

  /** Cache de templates en memoria para búsqueda rápida de tiendas */
  private storeCache: Map<string, { name: string; patterns: RegExp[]; defaultCategory: string }> =
    new Map();
  private storeCacheLastRefresh = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

  /** Intervalo de decay: cada 7 días */
  private readonly DECAY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
  /** Factor de decay por intervalo (multiplicador) */
  private readonly DECAY_FACTOR = 0.95;

  constructor(
    @InjectModel(TicketTemplate.name)
    private readonly templateModel: Model<TicketTemplateDocument>,
    @InjectModel(TicketScan.name)
    private readonly ticketModel: Model<TicketScanDocument>,
    private readonly structureAnalyzer: StructureAnalyzer,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // APRENDIZAJE PRINCIPAL
  // ═══════════════════════════════════════════════════════════════

  async learnFromTicket(ticket: TicketScanDocument): Promise<void> {
    try {
      const storeName = this.normalizeStoreName(ticket.tienda);
      if (!storeName || storeName === 'tienda desconocida') return;

      const rawText = ticket.ocrTextoRaw || (ticket as any).ocrBackText || '';
      if (!rawText) return;

      const fingerprint = this.structureAnalyzer.analyze(rawText);
      const correctionInfo = this.analyzeCorrections(ticket);
      const existing = await this.templateModel.findOne({ storeName });

      if (existing) {
        this.mergeTemplate(existing, ticket, fingerprint, correctionInfo);
        this.applyDecayIfNeeded(existing);
        await existing.save();
        this.storeCacheLastRefresh = 0;

        this.logger.log(
          `[LEARN] "${storeName}" v${existing.version} — ` +
          `n=${existing.ticketsProcessed} acc=${(existing.accuracy * 100).toFixed(1)}% ` +
          `fields=[${existing.fieldAccuracy.map(f => `${f.field}:${(f.accuracy * 100).toFixed(0)}%`).join(',')}] ` +
          `corrected=${correctionInfo.fieldsChanged.length > 0 ? correctionInfo.fieldsChanged.join(',') : 'none'}`,
        );

        // Anomaly check
        this.checkForAnomalies(existing);
      } else {
        const created = this.createTemplate(storeName, ticket, fingerprint, correctionInfo);
        await created.save();
        this.storeCacheLastRefresh = 0;

        this.logger.log(
          `[LEARN] NEW "${storeName}" — formats=[${created.itemFormats.map(f => f.name).join(',')}]`,
        );
      }
    } catch (err) {
      this.logger.error(`[LEARN] Error ticket ${ticket.ticketId}: ${err}`);
    }
  }

  async learnFromHistory(userId?: string, limit = 500): Promise<{ processed: number; templates: number }> {
    const query: any = {
      confirmado: true,
      estado: { $in: ['completed', 'liquidado'] },
      ocrTextoRaw: { $exists: true, $ne: '' },
    };
    if (userId) query.userId = userId;

    const tickets = await this.ticketModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    let processed = 0;
    for (const ticket of tickets) {
      await this.learnFromTicket(ticket as any);
      processed++;
    }

    const templates = await this.templateModel.countDocuments();
    this.logger.log(`[LEARN-HISTORY] ${processed} tickets → ${templates} templates`);
    return { processed, templates };
  }

  // ═══════════════════════════════════════════════════════════════
  // CONSULTA: pipeline OCR + store detector
  // ═══════════════════════════════════════════════════════════════

  async findStoreByText(
    headerText: string,
  ): Promise<{ storeName: string; defaultCategory: string; templateId: string } | null> {
    await this.refreshStoreCache();
    const text = headerText.toLowerCase();

    for (const [, entry] of this.storeCache) {
      if (entry.patterns.some(p => p.test(text))) {
        const template = await this.templateModel
          .findOne({ storeName: this.normalizeStoreName(entry.name), isActive: true })
          .lean();
        if (template) {
          return {
            storeName: entry.name,
            defaultCategory: entry.defaultCategory,
            templateId: (template as any)._id.toString(),
          };
        }
      }
    }
    return null;
  }

  /**
   * Hints enriquecidos para el pipeline OCR.
   * Incluye: extractor, formatos de items con confianza, patrones de totales,
   * posición de precios, líneas promedio, field accuracy para calibrar reviewLevel.
   */
  async getTemplateHints(storeName: string): Promise<{
    preferredExtractor: string;
    itemFormats: Array<{ name: string; regex: string; confidence: number }>;
    totalPatterns: Array<{ field: string; labels: string[]; hitCount: number }>;
    dateFormats: string[];
    headerKeywords: string[];
    avgLineCount: number;
    taxSuffixes: string[];
    sectionHeaders: Array<{ pattern: string; categoria: string }>;
    priceColumn: { avgPositionPct: number; isFixedColumn: boolean; minCharPos: number; separator: string } | null;
    avgItemCount: number;
    fieldAccuracy: Array<{ field: string; accuracy: number }>;
    hasMultiLineItems: boolean;
    temporalRelevance: number;
  } | null> {
    const normalized = this.normalizeStoreName(storeName);
    const template = await this.templateModel
      .findOne({ storeName: normalized, isActive: true })
      .lean();

    if (!template) return null;
    if (template.ticketsProcessed < template.maturityThreshold) {
      this.logger.debug(
        `[HINTS] "${normalized}" no maduro (${template.ticketsProcessed}/${template.maturityThreshold})`,
      );
      return null;
    }

    // Solo formatos con confianza > 0 y success > 0
    const formats = template.itemFormats
      .filter(f => f.successCount > 0)
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .map(f => ({ name: f.name, regex: f.regex, confidence: f.confidence || 0 }));

    return {
      preferredExtractor: this.bestExtractor(template),
      itemFormats: formats,
      totalPatterns: template.totalPatterns.map(t => ({
        field: t.field,
        labels: t.labels,
        hitCount: t.hitCount || 0,
      })),
      dateFormats: template.dateFormats,
      headerKeywords: template.headerKeywords,
      avgLineCount: template.avgLineCount,
      taxSuffixes: template.taxSuffixes,
      sectionHeaders: template.sectionHeaders,
      priceColumn: template.priceColumn || null,
      avgItemCount: template.avgItemCount || 0,
      fieldAccuracy: (template.fieldAccuracy || []).map(fa => ({
        field: fa.field,
        accuracy: fa.accuracy,
      })),
      hasMultiLineItems: false, // se puede derivar del fingerprint pero no está en el schema directo
      temporalRelevance: template.temporalRelevance ?? 1,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ADMIN / DASHBOARD
  // ═══════════════════════════════════════════════════════════════

  async listTemplates(filters?: {
    minAccuracy?: number;
    ticketType?: string;
    onlyMature?: boolean;
  }) {
    const query: any = { isActive: true };
    if (filters?.minAccuracy) query.accuracy = { $gte: filters.minAccuracy };
    if (filters?.ticketType) query.ticketType = filters.ticketType;
    if (filters?.onlyMature) query.$expr = { $gte: ['$ticketsProcessed', '$maturityThreshold'] };

    return this.templateModel
      .find(query)
      .select(
        'storeName ticketType ticketsProcessed ticketsCorrect accuracy avgConfidence ' +
        'preferredExtractor maturityThreshold fieldAccuracy extractorPerformance ' +
        'ocrSourcePerformance avgItemCount avgTotal temporalRelevance lastProcessedAt version',
      )
      .sort({ ticketsProcessed: -1 })
      .lean();
  }

  async getTemplate(storeName: string) {
    return this.templateModel.findOne({ storeName: this.normalizeStoreName(storeName) }).lean();
  }

  async getTemplateByStore(storeName: string) {
    return this.templateModel
      .findOne({ storeName: this.normalizeStoreName(storeName), isActive: true })
      .lean();
  }

  async getMetrics() {
    const [totalTemplates, matureTemplates, aggregated, fieldAggregated] = await Promise.all([
      this.templateModel.countDocuments({ isActive: true }),
      this.templateModel.countDocuments({
        isActive: true,
        $expr: { $gte: ['$ticketsProcessed', '$maturityThreshold'] },
      }),
      this.templateModel.aggregate([
        { $match: { isActive: true, ticketsProcessed: { $gte: 3 } } },
        {
          $group: {
            _id: null,
            avgAccuracy: { $avg: '$accuracy' },
            totalProcessed: { $sum: '$ticketsProcessed' },
            avgConfidence: { $avg: '$avgConfidence' },
            avgItemCount: { $avg: '$avgItemCount' },
          },
        },
      ]),
      // Field accuracy global
      this.templateModel.aggregate([
        { $match: { isActive: true, ticketsProcessed: { $gte: 3 } } },
        { $unwind: '$fieldAccuracy' },
        {
          $group: {
            _id: '$fieldAccuracy.field',
            avgAccuracy: { $avg: '$fieldAccuracy.accuracy' },
            totalCorrections: { $sum: '$fieldAccuracy.corrected' },
          },
        },
        { $sort: { avgAccuracy: 1 } },
      ]),
    ]);

    // Top extractors
    const extractorStats = await this.templateModel.aggregate([
      { $match: { isActive: true, ticketsProcessed: { $gte: 3 } } },
      { $unwind: '$extractorPerformance' },
      {
        $group: {
          _id: '$extractorPerformance.name',
          totalUsed: { $sum: '$extractorPerformance.timesUsed' },
          totalCorrect: { $sum: '$extractorPerformance.timesCorrect' },
          avgItems: { $avg: '$extractorPerformance.avgItemsExtracted' },
        },
      },
      { $sort: { totalUsed: -1 } },
    ]);

    return {
      totalTemplates,
      matureTemplates,
      avgAccuracy: aggregated[0]?.avgAccuracy ?? 0,
      totalTicketsLearned: aggregated[0]?.totalProcessed ?? 0,
      avgConfidence: aggregated[0]?.avgConfidence ?? 0,
      avgItemCount: aggregated[0]?.avgItemCount ?? 0,
      fieldAccuracy: fieldAggregated,
      extractorStats,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ANÁLISIS DE CORRECCIONES — qué campos fueron corregidos
  // ═══════════════════════════════════════════════════════════════

  private analyzeCorrections(ticket: TicketScanDocument): CorrectionAnalysis {
    const result: CorrectionAnalysis = {
      wasCorrect: !ticket.wasUserCorrected,
      fieldsChanged: [],
      details: [],
    };

    if (!ticket.wasUserCorrected || !ticket.userCorrections) return result;

    const uc = ticket.userCorrections;

    if (uc.tiendaOriginal && uc.tiendaOriginal !== ticket.tienda) {
      result.fieldsChanged.push('tienda');
      result.details.push({ field: 'tienda', original: uc.tiendaOriginal, corrected: ticket.tienda });
    }
    if (uc.fechaOriginal && uc.fechaOriginal !== (ticket as any).fecha?.toISOString?.()) {
      result.fieldsChanged.push('fecha');
      result.details.push({ field: 'fecha', original: uc.fechaOriginal, corrected: (ticket as any).fecha });
    }
    if (uc.totalOriginal != null && uc.totalOriginal !== ticket.total) {
      result.fieldsChanged.push('total');
      result.details.push({ field: 'total', original: uc.totalOriginal, corrected: ticket.total });
    }
    if (uc.subtotalOriginal != null && uc.subtotalOriginal !== (ticket as any).subtotal) {
      result.fieldsChanged.push('subtotal');
      result.details.push({ field: 'subtotal', original: uc.subtotalOriginal, corrected: (ticket as any).subtotal });
    }
    if (uc.impuestosOriginal != null && uc.impuestosOriginal !== (ticket as any).impuestos) {
      result.fieldsChanged.push('impuestos');
      result.details.push({ field: 'impuestos', original: uc.impuestosOriginal, corrected: (ticket as any).impuestos });
    }
    if (uc.itemsOriginal != null) {
      const currentItemCount = ticket.items?.length ?? 0;
      if (uc.itemsOriginal !== currentItemCount) {
        result.fieldsChanged.push('items');
        result.details.push({ field: 'items', original: uc.itemsOriginal, corrected: currentItemCount });
      }
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // CREATE TEMPLATE — con todos los nuevos sub-documentos
  // ═══════════════════════════════════════════════════════════════

  private createTemplate(
    storeName: string,
    ticket: TicketScanDocument,
    fp: StructuralFingerprint,
    correction: CorrectionAnalysis,
  ): TicketTemplateDocument {
    const now = new Date();
    const wasCorrect = correction.wasCorrect;
    const extractorUsed = (ticket as any).extractorUsed || 'generic';
    const ocrSource = (ticket as any).ocrBestSource || 'unknown';
    const itemCount = ticket.items?.length ?? 0;

    // Field accuracy inicial
    const fieldAccuracy = TRACKED_FIELDS.map(field => {
      const wasCorrected = correction.fieldsChanged.includes(field);
      let avgErrorMagnitude = 0;
      if (wasCorrected) {
        const detail = correction.details.find(d => d.field === field);
        if (detail && typeof detail.original === 'number' && typeof detail.corrected === 'number') {
          avgErrorMagnitude = Math.abs(detail.corrected - detail.original);
        }
      }
      return {
        field,
        correct: wasCorrected ? 0 : 1,
        corrected: wasCorrected ? 1 : 0,
        accuracy: wasCorrected ? 0 : 1,
        avgErrorMagnitude,
        trend: 0,
      };
    });

    // Extractor performance inicial
    const extractorPerformance = [{
      name: extractorUsed,
      timesUsed: 1,
      timesCorrect: wasCorrect ? 1 : 0,
      avgItemsExtracted: itemCount,
      accuracy: wasCorrect ? 1 : 0,
    }];

    // OCR source performance inicial
    const ocrSourcePerformance = [{
      source: ocrSource,
      timesSelected: 1,
      avgConfidence: ticket.ocrConfidence || 0,
      timesCorrect: wasCorrect ? 1 : 0,
    }];

    // Correction entry
    const recentCorrections = correction.fieldsChanged.length > 0
      ? [{ ticketId: ticket.ticketId, fieldsChanged: correction.fieldsChanged, details: correction.details, correctedAt: now }]
      : [];

    return new this.templateModel({
      storeName,
      storeAliases: [ticket.tienda],
      storePatterns: this.generateStorePatterns(ticket.tienda),
      ticketType: (ticket as any).tipoTicket || 'desconocido',
      defaultCategory: this.inferDefaultCategory(ticket),
      zones: fp.zones,
      itemFormats: fp.itemFormats.map(f => ({
        name: f.name,
        regex: f.regex,
        captureGroups: [],
        matchRate: f.matchRate,
        successCount: wasCorrect ? 1 : 0,
        failCount: wasCorrect ? 0 : 1,
        confidence: wasCorrect ? 1 : 0,
        lastUsedAt: now,
      })),
      totalPatterns: fp.totalPatterns.map(tp => ({
        ...tp,
        hitCount: wasCorrect ? 1 : 0,
      })),
      dateFormats: fp.dateFormats,
      headerKeywords: fp.headerKeywords,
      footerKeywords: fp.footerKeywords,
      excludePatterns: fp.excludePatterns,
      preferredExtractor: extractorUsed,
      ticketsProcessed: 1,
      ticketsCorrect: wasCorrect ? 1 : 0,
      accuracy: wasCorrect ? 1.0 : 0.0,
      avgConfidence: ticket.ocrConfidence || 0,
      lastTicketId: ticket.ticketId,
      avgLineCount: fp.lineCount,
      sectionHeaders: fp.sectionHeaders,
      taxSuffixes: fp.taxSuffixes,
      priceColumn: fp.priceColumn || null,
      avgItemLineCount: fp.itemLineCount,
      avgItemCount: itemCount,
      avgTotal: ticket.total || 0,
      fieldAccuracy,
      extractorPerformance,
      ocrSourcePerformance,
      recentCorrections,
      lastDecayAt: now,
      temporalRelevance: 1,
      lastProcessedAt: now,
      version: 1,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // MERGE TEMPLATE — con aprendizaje por corrección
  // ═══════════════════════════════════════════════════════════════

  private mergeTemplate(
    tpl: TicketTemplateDocument,
    ticket: TicketScanDocument,
    fp: StructuralFingerprint,
    correction: CorrectionAnalysis,
  ): void {
    const wasCorrect = correction.wasCorrect;
    const now = new Date();
    const n = ++tpl.ticketsProcessed;
    if (wasCorrect) tpl.ticketsCorrect++;
    tpl.accuracy = tpl.ticketsCorrect / n;
    tpl.avgConfidence = this.runningAvg(tpl.avgConfidence, ticket.ocrConfidence || 0, n);
    tpl.lastTicketId = ticket.ticketId;
    tpl.lastProcessedAt = now;
    tpl.version++;

    // ─── 1. Store aliases ──────────────────────────────────────
    if (!tpl.storeAliases.includes(ticket.tienda)) {
      tpl.storeAliases.push(ticket.tienda);
      for (const p of this.generateStorePatterns(ticket.tienda)) {
        if (!tpl.storePatterns.includes(p)) tpl.storePatterns.push(p);
      }
    }

    // Si la tienda fue corregida, aprender el nombre corregido como alias
    if (correction.fieldsChanged.includes('tienda')) {
      const corrected = correction.details.find(d => d.field === 'tienda')?.corrected as string | undefined;
      if (corrected && !tpl.storeAliases.includes(corrected)) {
        tpl.storeAliases.push(corrected);
        for (const p of this.generateStorePatterns(corrected)) {
          if (!tpl.storePatterns.includes(p)) tpl.storePatterns.push(p);
        }
      }
    }

    // ─── 2. Item formats por nombre, con fail tracking ─────────
    for (const newFmt of fp.itemFormats) {
      const ex = tpl.itemFormats.find(f => f.name === newFmt.name);
      if (ex) {
        ex.matchRate = this.runningAvg(ex.matchRate, newFmt.matchRate, n);
        if (wasCorrect) ex.successCount++;
        else ex.failCount = (ex.failCount || 0) + 1;
        ex.confidence = ex.successCount / (ex.successCount + (ex.failCount || 0));
        ex.lastUsedAt = now;
      } else {
        tpl.itemFormats.push({
          name: newFmt.name,
          regex: newFmt.regex,
          captureGroups: [],
          matchRate: newFmt.matchRate,
          successCount: wasCorrect ? 1 : 0,
          failCount: wasCorrect ? 0 : 1,
          confidence: wasCorrect ? 1 : 0,
          lastUsedAt: now,
        });
      }
    }
    // Ordenar por confidence * successCount descendente
    tpl.itemFormats.sort((a, b) => {
      const scoreA = (a.confidence || 0) * (a.successCount || 0);
      const scoreB = (b.confidence || 0) * (b.successCount || 0);
      return scoreB - scoreA;
    });

    // ─── 3. Total patterns con hitCount ────────────────────────
    for (const newTp of fp.totalPatterns) {
      const ex = tpl.totalPatterns.find(t => t.field === newTp.field);
      if (ex) {
        for (const label of newTp.labels) {
          if (!ex.labels.includes(label)) ex.labels.push(label);
        }
        ex.positionFromBottom = this.runningAvg(ex.positionFromBottom, newTp.positionFromBottom, n);
        if (wasCorrect) ex.hitCount = (ex.hitCount || 0) + 1;
      } else {
        tpl.totalPatterns.push({ ...newTp, hitCount: wasCorrect ? 1 : 0 });
      }
    }

    // ─── 4. Date, keywords, etc. ───────────────────────────────
    for (const df of fp.dateFormats) {
      if (!tpl.dateFormats.includes(df)) tpl.dateFormats.push(df);
    }
    tpl.headerKeywords = this.mergeKeywords(tpl.headerKeywords, fp.headerKeywords, 15);
    tpl.footerKeywords = this.mergeKeywords(tpl.footerKeywords, fp.footerKeywords, 15);
    tpl.avgLineCount = this.runningAvg(tpl.avgLineCount, fp.lineCount, n);
    for (const sh of fp.sectionHeaders) {
      if (!tpl.sectionHeaders.some(s => s.pattern === sh.pattern)) tpl.sectionHeaders.push(sh);
    }
    for (const ts of fp.taxSuffixes) {
      if (!tpl.taxSuffixes.includes(ts)) tpl.taxSuffixes.push(ts);
    }

    // ─── 5. Price column — merge running average ───────────────
    if (fp.priceColumn) {
      if (!tpl.priceColumn) {
        tpl.priceColumn = fp.priceColumn;
      } else {
        tpl.priceColumn.avgPositionPct = this.runningAvg(tpl.priceColumn.avgPositionPct, fp.priceColumn.avgPositionPct, n);
        tpl.priceColumn.minCharPos = Math.min(tpl.priceColumn.minCharPos, fp.priceColumn.minCharPos);
        tpl.priceColumn.isFixedColumn = tpl.priceColumn.isFixedColumn && fp.priceColumn.isFixedColumn;
        // Si el separador cambió, preferir el nuevo si ya tenemos suficientes datos
        if (n > 3) tpl.priceColumn.separator = fp.priceColumn.separator;
      }
    }

    // ─── 6. Avg item metrics ───────────────────────────────────
    const itemCount = ticket.items?.length ?? 0;
    tpl.avgItemLineCount = this.runningAvg(tpl.avgItemLineCount || 0, fp.itemLineCount, n);
    tpl.avgItemCount = this.runningAvg(tpl.avgItemCount || 0, itemCount, n);
    tpl.avgTotal = this.runningAvg(tpl.avgTotal || 0, ticket.total || 0, n);

    // ─── 7. Field accuracy per-field ───────────────────────────
    this.updateFieldAccuracy(tpl, correction);

    // ─── 8. Extractor performance ──────────────────────────────
    this.updateExtractorPerformance(tpl, ticket, wasCorrect, itemCount);

    // ─── 9. OCR source performance ─────────────────────────────
    this.updateOcrSourcePerformance(tpl, ticket, wasCorrect);

    // ─── 10. Recent corrections (FIFO, max 20) ────────────────
    if (correction.fieldsChanged.length > 0) {
      tpl.recentCorrections = tpl.recentCorrections || [];
      tpl.recentCorrections.push({
        ticketId: ticket.ticketId,
        fieldsChanged: correction.fieldsChanged,
        details: correction.details,
        correctedAt: now,
      });
      if (tpl.recentCorrections.length > 20) {
        tpl.recentCorrections = tpl.recentCorrections.slice(-20);
      }
    }

    // ─── 11. Preferred extractor (basado en data) ──────────────
    tpl.preferredExtractor = this.bestExtractor(tpl);

    // ─── 12. Ticket type ───────────────────────────────────────
    const ticketType = (ticket as any).tipoTicket;
    if (ticketType && ticketType !== 'desconocido') tpl.ticketType = ticketType;

    // Marcar subdocumentos modificados
    tpl.markModified('itemFormats');
    tpl.markModified('totalPatterns');
    tpl.markModified('zones');
    tpl.markModified('sectionHeaders');
    tpl.markModified('fieldAccuracy');
    tpl.markModified('extractorPerformance');
    tpl.markModified('ocrSourcePerformance');
    tpl.markModified('recentCorrections');
    tpl.markModified('priceColumn');
  }

  // ═══════════════════════════════════════════════════════════════
  // FIELD ACCURACY
  // ═══════════════════════════════════════════════════════════════

  private updateFieldAccuracy(tpl: TicketTemplateDocument, correction: CorrectionAnalysis): void {
    tpl.fieldAccuracy = tpl.fieldAccuracy || [];

    for (const field of TRACKED_FIELDS) {
      const wasCorrected = correction.fieldsChanged.includes(field);
      let entry = tpl.fieldAccuracy.find(fa => fa.field === field);

      if (!entry) {
        entry = { field, correct: 0, corrected: 0, accuracy: 1, avgErrorMagnitude: 0, trend: 0 };
        tpl.fieldAccuracy.push(entry);
      }

      if (wasCorrected) {
        entry.corrected++;
        // Update error magnitude for numeric fields
        const detail = correction.details.find(d => d.field === field);
        if (detail && typeof detail.original === 'number' && typeof detail.corrected === 'number') {
          const error = Math.abs(detail.corrected - detail.original);
          const totalCorrected = entry.corrected;
          entry.avgErrorMagnitude = entry.avgErrorMagnitude + (error - entry.avgErrorMagnitude) / totalCorrected;
        }
      } else {
        entry.correct++;
      }

      const total = entry.correct + entry.corrected;
      const newAccuracy = total > 0 ? entry.correct / total : 1;

      // Trend: positivo = mejorando, negativo = empeorando
      // simple exponential smoothing of delta
      const delta = newAccuracy - entry.accuracy;
      entry.trend = entry.trend * 0.7 + delta * 0.3;
      entry.accuracy = newAccuracy;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTOR PERFORMANCE
  // ═══════════════════════════════════════════════════════════════

  private updateExtractorPerformance(
    tpl: TicketTemplateDocument,
    ticket: TicketScanDocument,
    wasCorrect: boolean,
    itemCount: number,
  ): void {
    const extractorName = (ticket as any).extractorUsed || 'generic';
    tpl.extractorPerformance = tpl.extractorPerformance || [];

    let entry = tpl.extractorPerformance.find(e => e.name === extractorName);
    if (!entry) {
      entry = { name: extractorName, timesUsed: 0, timesCorrect: 0, avgItemsExtracted: 0, accuracy: 0 };
      tpl.extractorPerformance.push(entry);
    }

    entry.timesUsed++;
    if (wasCorrect) entry.timesCorrect++;
    entry.avgItemsExtracted = entry.avgItemsExtracted + (itemCount - entry.avgItemsExtracted) / entry.timesUsed;
    entry.accuracy = entry.timesUsed > 0 ? entry.timesCorrect / entry.timesUsed : 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // OCR SOURCE PERFORMANCE
  // ═══════════════════════════════════════════════════════════════

  private updateOcrSourcePerformance(
    tpl: TicketTemplateDocument,
    ticket: TicketScanDocument,
    wasCorrect: boolean,
  ): void {
    const source = (ticket as any).ocrBestSource || 'unknown';
    tpl.ocrSourcePerformance = tpl.ocrSourcePerformance || [];

    let entry = tpl.ocrSourcePerformance.find(e => e.source === source);
    if (!entry) {
      entry = { source, timesSelected: 0, avgConfidence: 0, timesCorrect: 0 };
      tpl.ocrSourcePerformance.push(entry);
    }

    entry.timesSelected++;
    if (wasCorrect) entry.timesCorrect++;
    entry.avgConfidence = entry.avgConfidence + ((ticket.ocrConfidence || 0) - entry.avgConfidence) / entry.timesSelected;
  }

  // ═══════════════════════════════════════════════════════════════
  // PATTERN DECAY — reduce confianza de formatos no usados
  // ═══════════════════════════════════════════════════════════════

  private applyDecayIfNeeded(tpl: TicketTemplateDocument): void {
    const now = Date.now();
    const lastDecay = tpl.lastDecayAt?.getTime() || 0;

    if (now - lastDecay < this.DECAY_INTERVAL_MS) return;

    // Cuántos intervalos pasaron
    const intervals = Math.floor((now - lastDecay) / this.DECAY_INTERVAL_MS);
    const decayFactor = Math.pow(this.DECAY_FACTOR, intervals);

    // Decay temporal relevance
    tpl.temporalRelevance = Math.max(0.1, (tpl.temporalRelevance || 1) * decayFactor);

    // Decay item format confidence para formatos no usados recientemente
    const cutoff = new Date(now - this.DECAY_INTERVAL_MS * 2);
    for (const fmt of tpl.itemFormats) {
      if (fmt.lastUsedAt && fmt.lastUsedAt < cutoff) {
        fmt.confidence = Math.max(0, (fmt.confidence || 0) * decayFactor);
      }
    }

    tpl.lastDecayAt = new Date(now);
    tpl.markModified('itemFormats');
  }

  // ═══════════════════════════════════════════════════════════════
  // ANOMALY DETECTION
  // ═══════════════════════════════════════════════════════════════

  private checkForAnomalies(tpl: TicketTemplateDocument): void {
    if (tpl.ticketsProcessed < 10) return;

    // Check global accuracy decline
    if (tpl.accuracy < 0.5) {
      this.logger.warn(
        `[ANOMALY] "${tpl.storeName}" accuracy=${(tpl.accuracy * 100).toFixed(1)}% — ` +
        `below 50% threshold after ${tpl.ticketsProcessed} tickets`,
      );
    }

    // Check field-level trends
    for (const fa of tpl.fieldAccuracy || []) {
      if (fa.trend < -0.1 && fa.corrected > 3) {
        this.logger.warn(
          `[ANOMALY] "${tpl.storeName}" field="${fa.field}" trend=${fa.trend.toFixed(3)} — ` +
          `declining accuracy (${(fa.accuracy * 100).toFixed(1)}%, corrected ${fa.corrected}x)`,
        );
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // BEST EXTRACTOR — elegir el mejor basado en datos
  // ═══════════════════════════════════════════════════════════════

  private bestExtractor(tpl: TicketTemplateDocument | any): string {
    const perfs = tpl.extractorPerformance as Array<{ name: string; timesUsed: number; timesCorrect: number; accuracy: number }>;
    if (!perfs || perfs.length === 0) return tpl.preferredExtractor || 'generic';

    // El que tenga mejor accuracy con al menos 2 usos
    const candidates = perfs.filter(e => e.timesUsed >= 2);
    if (candidates.length === 0) return perfs[0].name;

    candidates.sort((a, b) => b.accuracy - a.accuracy || b.timesUsed - a.timesUsed);
    return candidates[0].name;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private normalizeStoreName(name: string): string {
    return name.toLowerCase().replace(/['''`]/g, '').replace(/\s+/g, ' ').trim();
  }

  private generateStorePatterns(storeName: string): string[] {
    const normalized = this.normalizeStoreName(storeName);
    const patterns: string[] = [];
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Exacto
    patterns.push(esc(normalized));

    // Espacios flexibles
    const words = normalized.split(/\s+/).filter(w => w.length > 2);
    if (words.length >= 2) {
      patterns.push(words.map(esc).join('\\s+'));
    }

    // Palabra larga como patrón parcial
    const longWord = words.find(w => w.length > 4);
    if (longWord) patterns.push(esc(longWord));

    // OCR noise tolerant: reemplazar caracteres comúnmente confundidos
    if (longWord && longWord.length > 5) {
      const noisy = longWord
        .replace(/o/g, '[o0]')
        .replace(/i/g, '[il1]')
        .replace(/s/g, '[s5]')
        .replace(/e/g, '[e3]')
        .replace(/a/g, '[aá@]');
      if (noisy !== esc(longWord)) patterns.push(noisy);
    }

    return [...new Set(patterns)];
  }

  private inferDefaultCategory(ticket: TicketScanDocument): string {
    const cats = (ticket as any).resumenCategorias as Record<string, number> | undefined;
    if (cats && Object.keys(cats).length > 0) {
      return Object.entries(cats).sort((a, b) => b[1] - a[1])[0][0];
    }
    return 'otros';
  }

  private runningAvg(currentAvg: number, newValue: number, count: number): number {
    if (count <= 1) return newValue;
    return currentAvg + (newValue - currentAvg) / count;
  }

  private mergeKeywords(existing: string[], incoming: string[], maxSize: number): string[] {
    const set = new Set(existing);
    for (const kw of incoming) set.add(kw);
    return [...set].slice(0, maxSize);
  }

  private async refreshStoreCache(): Promise<void> {
    if (Date.now() - this.storeCacheLastRefresh < this.CACHE_TTL_MS) return;

    const templates = await this.templateModel
      .find({ isActive: true })
      .select('storeName storePatterns defaultCategory')
      .lean();

    this.storeCache.clear();

    for (const t of templates) {
      const patterns: RegExp[] = [];
      for (const p of t.storePatterns) {
        try { patterns.push(new RegExp(p, 'i')); } catch { /* skip */ }
      }
      if (patterns.length > 0) {
        this.storeCache.set(t.storeName, {
          name: t.storeName,
          patterns,
          defaultCategory: t.defaultCategory,
        });
      }
    }

    this.storeCacheLastRefresh = Date.now();
    this.logger.debug(`[CACHE] Store cache: ${this.storeCache.size} tiendas`);
  }
}

// ─── Tipo interno para resultado de análisis de correcciones ───
interface CorrectionAnalysis {
  wasCorrect: boolean;
  fieldsChanged: string[];
  details: Array<{ field: string; original: any; corrected: any }>;
}
