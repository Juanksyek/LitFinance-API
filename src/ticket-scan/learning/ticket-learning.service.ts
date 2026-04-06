import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TicketTemplate, TicketTemplateDocument } from './ticket-template.schema';
import { StructureAnalyzer, StructuralFingerprint } from './structure-analyzer';
import { TicketScan, TicketScanDocument } from '../schemas/ticket-scan.schema';

/**
 * Servicio de aprendizaje continuo de tickets.
 *
 * Cada vez que un usuario confirma un ticket (con o sin correcciones),
 * este servicio extrae la estructura del ticket y actualiza (o crea) un
 * template que describe cómo se ven los tickets de esa tienda.
 *
 * Flujo:
 *   1. confirmAndCharge() → learnFromTicket(ticket)
 *   2. Analizar texto OCR crudo → StructuralFingerprint
 *   3. Buscar template existente por storeName  (or create)
 *   4. Merge nuevo fingerprint con datos acumulados
 *   5. Actualizar métricas de accuracy
 *
 * Consumo:
 *   - StoreDetector llama findStoreByText() para detectar tiendas aprendidas
 *   - OcrPipeline llama getTemplateHints() para guiar la extracción
 */
@Injectable()
export class TicketLearningService {
  private readonly logger = new Logger(TicketLearningService.name);

  /** Cache de templates en memoria para búsqueda rápida de tiendas */
  private storeCache: Map<string, { name: string; patterns: RegExp[]; defaultCategory: string }> =
    new Map();
  private storeCacheLastRefresh = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

  constructor(
    @InjectModel(TicketTemplate.name)
    private readonly templateModel: Model<TicketTemplateDocument>,
    @InjectModel(TicketScan.name)
    private readonly ticketModel: Model<TicketScanDocument>,
    private readonly structureAnalyzer: StructureAnalyzer,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // APRENDIZAJE: llamado después de confirmar un ticket
  // ═══════════════════════════════════════════════════════════════

  /**
   * Aprende de un ticket confirmado.
   * Se ejecuta en background (fire-and-forget) para no bloquear la respuesta.
   */
  async learnFromTicket(ticket: TicketScanDocument): Promise<void> {
    try {
      const storeName = this.normalizeStoreName(ticket.tienda);
      if (!storeName || storeName === 'tienda desconocida') {
        this.logger.debug('[LEARN] Tienda desconocida, skip learning');
        return;
      }

      // Analizar estructura del texto OCR crudo
      const rawText = ticket.ocrTextoRaw || ticket.ocrBackText || '';
      if (!rawText) {
        this.logger.debug('[LEARN] Sin texto OCR crudo, skip learning');
        return;
      }

      const fingerprint = this.structureAnalyzer.analyze(rawText);

      // Buscar o crear template
      const existing = await this.templateModel.findOne({ storeName });

      if (existing) {
        this.mergeTemplate(existing, ticket, fingerprint);
        await existing.save();

        this.storeCacheLastRefresh = 0;
        this.logger.log(
          `[LEARN] Template "${storeName}" v${existing.version} — ` +
          `processed=${existing.ticketsProcessed} accuracy=${(existing.accuracy * 100).toFixed(1)}% ` +
          `formats=[${existing.itemFormats.map(f => f.name).join(',')}]`,
        );
      } else {
        const created = this.createTemplate(storeName, ticket, fingerprint);
        await created.save();

        this.storeCacheLastRefresh = 0;
        this.logger.log(
          `[LEARN] Template NEW "${storeName}" — ` +
          `formats=[${created.itemFormats.map(f => f.name).join(',')}]`,
        );
      }
    } catch (err) {
      this.logger.error(`[LEARN] Error learning from ticket ${ticket.ticketId}: ${err}`);
    }
  }

  /**
   * Aprende en lote de tickets históricos ya confirmados.
   * Útil para bootstrap inicial del sistema de aprendizaje.
   */
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
    this.logger.log(`[LEARN-HISTORY] Processed ${processed} tickets → ${templates} templates`);
    return { processed, templates };
  }

  // ═══════════════════════════════════════════════════════════════
  // CONSULTA: usado por el pipeline OCR
  // ═══════════════════════════════════════════════════════════════

  /**
   * Busca si un texto OCR coincide con alguna tienda aprendida.
   * Devuelve el template + tienda detectada, o null.
   */
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
   * Devuelve hints para el pipeline OCR basado en el template de la tienda.
   * Si no existe template o no está maduro, devuelve null.
   */
  async getTemplateHints(storeName: string): Promise<{
    preferredExtractor: string;
    itemFormats: Array<{ name: string; regex: string }>;
    totalPatterns: Array<{ field: string; labels: string[] }>;
    dateFormats: string[];
    headerKeywords: string[];
    avgLineCount: number;
    taxSuffixes: string[];
    sectionHeaders: Array<{ pattern: string; categoria: string }>;
  } | null> {
    const normalized = this.normalizeStoreName(storeName);
    const template = await this.templateModel
      .findOne({ storeName: normalized, isActive: true })
      .lean();

    if (!template) return null;

    // Solo usar hints si el template es maduro (tiene suficientes datos)
    if (template.ticketsProcessed < template.maturityThreshold) {
      this.logger.debug(
        `[HINTS] Template "${normalized}" no maduro (${template.ticketsProcessed}/${template.maturityThreshold})`,
      );
      return null;
    }

    return {
      preferredExtractor: template.preferredExtractor,
      itemFormats: template.itemFormats
        .filter(f => f.successCount > 0)
        .map(f => ({ name: f.name, regex: f.regex })),
      totalPatterns: template.totalPatterns.map(t => ({
        field: t.field,
        labels: t.labels,
      })),
      dateFormats: template.dateFormats,
      headerKeywords: template.headerKeywords,
      avgLineCount: template.avgLineCount,
      taxSuffixes: template.taxSuffixes,
      sectionHeaders: template.sectionHeaders,
    };
  }

  /**
   * Lista todos los templates con sus métricas (para dashboard/admin).
   */
  async listTemplates(filters?: {
    minAccuracy?: number;
    ticketType?: string;
    onlyMature?: boolean;
  }) {
    const query: any = { isActive: true };

    if (filters?.minAccuracy) {
      query.accuracy = { $gte: filters.minAccuracy };
    }
    if (filters?.ticketType) {
      query.ticketType = filters.ticketType;
    }
    if (filters?.onlyMature) {
      query.$expr = { $gte: ['$ticketsProcessed', '$maturityThreshold'] };
    }

    return this.templateModel
      .find(query)
      .select('-storePatterns -zones -itemFormats -totalPatterns -excludePatterns')
      .sort({ ticketsProcessed: -1 })
      .lean();
  }

  /**
   * Obtiene un template por storeName.
   */
  async getTemplate(storeName: string) {
    return this.templateModel
      .findOne({ storeName: this.normalizeStoreName(storeName) })
      .lean();
  }

  /**
   * Obtiene las métricas globales del sistema de aprendizaje.
   */
  async getMetrics() {
    const [totalTemplates, matureTemplates, avgAccuracy] = await Promise.all([
      this.templateModel.countDocuments({ isActive: true }),
      this.templateModel.countDocuments({
        isActive: true,
        $expr: { $gte: ['$ticketsProcessed', '$maturityThreshold'] },
      }),
      this.templateModel.aggregate([
        { $match: { isActive: true, ticketsProcessed: { $gte: 3 } } },
        { $group: { _id: null, avg: { $avg: '$accuracy' }, totalProcessed: { $sum: '$ticketsProcessed' } } },
      ]),
    ]);

    return {
      totalTemplates,
      matureTemplates,
      avgAccuracy: avgAccuracy[0]?.avg ?? 0,
      totalTicketsLearned: avgAccuracy[0]?.totalProcessed ?? 0,
    };
  }

  /**
   * Obtiene un template por nombre de tienda (normalizado).
   */
  async getTemplateByStore(storeName: string) {
    const normalized = this.normalizeStoreName(storeName);
    return this.templateModel.findOne({ storeName: normalized, isActive: true }).lean();
  }

  // ═══════════════════════════════════════════════════════════════
  // INTERNOS
  // ═══════════════════════════════════════════════════════════════

  private createTemplate(
    storeName: string,
    ticket: TicketScanDocument,
    fp: StructuralFingerprint,
  ): TicketTemplateDocument {
    const wasCorrect = !ticket.wasUserCorrected;

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
      })),
      totalPatterns: fp.totalPatterns,
      dateFormats: fp.dateFormats,
      headerKeywords: fp.headerKeywords,
      footerKeywords: fp.footerKeywords,
      excludePatterns: fp.excludePatterns,
      preferredExtractor: (ticket as any).extractorUsed || 'generic',
      ticketsProcessed: 1,
      ticketsCorrect: wasCorrect ? 1 : 0,
      accuracy: wasCorrect ? 1.0 : 0.0,
      avgConfidence: ticket.ocrConfidence || 0,
      lastTicketId: ticket.ticketId,
      avgLineCount: fp.lineCount,
      sectionHeaders: fp.sectionHeaders,
      taxSuffixes: fp.taxSuffixes,
      version: 1,
    });
  }

  private mergeTemplate(
    template: TicketTemplateDocument,
    ticket: TicketScanDocument,
    fp: StructuralFingerprint,
  ): void {
    const wasCorrect = !ticket.wasUserCorrected;

    // 1. Métricas
    template.ticketsProcessed++;
    if (wasCorrect) template.ticketsCorrect++;
    template.accuracy = template.ticketsCorrect / template.ticketsProcessed;
    template.avgConfidence = this.runningAvg(
      template.avgConfidence,
      ticket.ocrConfidence || 0,
      template.ticketsProcessed,
    );
    template.lastTicketId = ticket.ticketId;
    template.version++;

    // 2. Store aliases
    if (!template.storeAliases.includes(ticket.tienda)) {
      template.storeAliases.push(ticket.tienda);
      // Regenerar patrones con el nuevo alias
      const newPatterns = this.generateStorePatterns(ticket.tienda);
      for (const p of newPatterns) {
        if (!template.storePatterns.includes(p)) {
          template.storePatterns.push(p);
        }
      }
    }

    // 3. Item formats — merge por nombre
    for (const newFmt of fp.itemFormats) {
      const existing = template.itemFormats.find(f => f.name === newFmt.name);
      if (existing) {
        existing.matchRate = this.runningAvg(
          existing.matchRate,
          newFmt.matchRate,
          template.ticketsProcessed,
        );
        if (wasCorrect) existing.successCount++;
      } else {
        template.itemFormats.push({
          name: newFmt.name,
          regex: newFmt.regex,
          captureGroups: [],
          matchRate: newFmt.matchRate,
          successCount: wasCorrect ? 1 : 0,
        });
      }
    }

    // Ordenar por successCount descendente
    template.itemFormats.sort((a, b) => b.successCount - a.successCount);

    // 4. Total patterns — merge labels
    for (const newTp of fp.totalPatterns) {
      const existing = template.totalPatterns.find(t => t.field === newTp.field);
      if (existing) {
        for (const label of newTp.labels) {
          if (!existing.labels.includes(label)) {
            existing.labels.push(label);
          }
        }
        // Promedio de posición
        existing.positionFromBottom = this.runningAvg(
          existing.positionFromBottom,
          newTp.positionFromBottom,
          template.ticketsProcessed,
        );
      } else {
        template.totalPatterns.push(newTp);
      }
    }

    // 5. Date formats
    for (const df of fp.dateFormats) {
      if (!template.dateFormats.includes(df)) {
        template.dateFormats.push(df);
      }
    }

    // 6. Keywords — merge con cap
    template.headerKeywords = this.mergeKeywords(template.headerKeywords, fp.headerKeywords, 15);
    template.footerKeywords = this.mergeKeywords(template.footerKeywords, fp.footerKeywords, 15);

    // 7. Avg line count
    template.avgLineCount = this.runningAvg(
      template.avgLineCount,
      fp.lineCount,
      template.ticketsProcessed,
    );

    // 8. Section headers
    for (const sh of fp.sectionHeaders) {
      if (!template.sectionHeaders.some(s => s.pattern === sh.pattern)) {
        template.sectionHeaders.push(sh);
      }
    }

    // 9. Tax suffixes
    for (const ts of fp.taxSuffixes) {
      if (!template.taxSuffixes.includes(ts)) {
        template.taxSuffixes.push(ts);
      }
    }

    // 10. Preferred extractor — si el actual funciona mejor, cambiar
    const currentExtractor = (ticket as any).extractorUsed;
    if (wasCorrect && currentExtractor && currentExtractor !== template.preferredExtractor) {
      // Contar éxitos del extractor actual en los itemFormats
      const currentSuccess = template.itemFormats
        .filter(f => f.successCount > 0)
        .reduce((sum, f) => sum + f.successCount, 0);
      if (currentSuccess > template.ticketsCorrect * 0.5) {
        template.preferredExtractor = currentExtractor;
      }
    }

    // 11. Ticket type — actualizar si cambió
    const ticketType = (ticket as any).tipoTicket;
    if (ticketType && ticketType !== 'desconocido') {
      template.ticketType = ticketType;
    }

    // Marcar como modificado para Mongoose
    template.markModified('itemFormats');
    template.markModified('totalPatterns');
    template.markModified('zones');
    template.markModified('sectionHeaders');
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private normalizeStoreName(name: string): string {
    return name
      .toLowerCase()
      .replace(/['''`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private generateStorePatterns(storeName: string): string[] {
    const normalized = this.normalizeStoreName(storeName);
    const patterns: string[] = [];

    // Patrón exacto (case insensitive)
    patterns.push(normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    // Patrón con espacios flexibles
    const words = normalized.split(/\s+/).filter(w => w.length > 2);
    if (words.length >= 2) {
      patterns.push(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
    }

    // Primera palabra larga (>4 chars) como patrón parcial
    const longWord = words.find(w => w.length > 4);
    if (longWord) {
      patterns.push(longWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }

    return [...new Set(patterns)];
  }

  private inferDefaultCategory(ticket: TicketScanDocument): string {
    // Usar resumenCategorias si existe
    const cats = (ticket as any).resumenCategorias as Record<string, number> | undefined;
    if (cats && Object.keys(cats).length > 0) {
      // La categoría con mayor monto
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
    for (const kw of incoming) {
      set.add(kw);
    }
    return [...set].slice(0, maxSize);
  }

  /**
   * Refresca la cache de patrones de tiendas aprendidas.
   */
  private async refreshStoreCache(): Promise<void> {
    if (Date.now() - this.storeCacheLastRefresh < this.CACHE_TTL_MS) {
      return;
    }

    const templates = await this.templateModel
      .find({ isActive: true })
      .select('storeName storePatterns defaultCategory')
      .lean();

    this.storeCache.clear();

    for (const t of templates) {
      const patterns: RegExp[] = [];
      for (const p of t.storePatterns) {
        try {
          patterns.push(new RegExp(p, 'i'));
        } catch {
          // Patrón regex inválido, skip
        }
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
    this.logger.debug(`[CACHE] Refreshed store cache: ${this.storeCache.size} tiendas aprendidas`);
  }
}
