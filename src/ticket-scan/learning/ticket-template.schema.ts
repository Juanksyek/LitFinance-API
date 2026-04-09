import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// ─── Sub-documento: patrón de zona del ticket ──────────────────

export class ZonePattern {
  @Prop({ required: true })
  zone: string;

  @Prop({ type: [Number], default: [0, 100] })
  lineRange: number[];

  @Prop({ type: [String], default: [] })
  patterns: string[];

  @Prop({ type: [String], default: [] })
  keywords: string[];
}

// ─── Sub-documento: formato de línea de item ───────────────────

export class ItemLineFormat {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  regex: string;

  @Prop({ type: [String], default: [] })
  captureGroups: string[];

  /** Porcentaje de items que matchean (0-1) */
  @Prop({ default: 0 })
  matchRate: number;

  /** Tickets donde este formato extrajo items correctamente */
  @Prop({ default: 0 })
  successCount: number;

  /** Tickets donde este formato se intentó pero no tuvo éxito */
  @Prop({ default: 0 })
  failCount: number;

  /** Confianza calculada: successCount / (successCount + failCount) */
  @Prop({ default: 0 })
  confidence: number;

  /** Última vez que este formato fue usado */
  @Prop()
  lastUsedAt: Date;
}

// ─── Sub-documento: patrón de totales ──────────────────────────

export class TotalLinePattern {
  @Prop({ required: true })
  field: string;

  @Prop({ type: [String], default: [] })
  labels: string[];

  @Prop({ default: 0 })
  positionFromBottom: number;

  /** Veces que este patrón extrajo el valor correcto */
  @Prop({ default: 0 })
  hitCount: number;
}

// ─── Sub-documento: accuracy por campo ─────────────────────────

export class FieldAccuracyStats {
  @Prop({ required: true })
  field: string; // tienda|fecha|total|subtotal|impuestos|items

  /** Veces que este campo NO fue corregido */
  @Prop({ default: 0 })
  correct: number;

  /** Veces que este campo fue corregido por el usuario */
  @Prop({ default: 0 })
  corrected: number;

  /** Accuracy: correct / (correct + corrected) */
  @Prop({ default: 1 })
  accuracy: number;

  /** Para numéricos: error promedio absoluto cuando fue corregido */
  @Prop({ default: 0 })
  avgErrorMagnitude: number;

  /** Tendencia de accuracy en los últimos N tickets (positivo = mejorando) */
  @Prop({ default: 0 })
  trend: number;
}

// ─── Sub-documento: rendimiento por extractor ──────────────────

export class ExtractorPerformance {
  /** Nombre del extractor (supermarket|restaurant|generic) */
  @Prop({ required: true })
  name: string;

  @Prop({ default: 0 })
  timesUsed: number;

  @Prop({ default: 0 })
  timesCorrect: number;

  /** Items promedio extraídos */
  @Prop({ default: 0 })
  avgItemsExtracted: number;

  @Prop({ default: 0 })
  accuracy: number;
}

// ─── Sub-documento: rendimiento por fuente OCR ─────────────────

export class OcrSourcePerformance {
  /** Fuente: "paddle:contrast", "tesseract:grayscale", "azure", etc. */
  @Prop({ required: true })
  source: string;

  @Prop({ default: 0 })
  timesSelected: number;

  /** Confianza promedio cuando esta fuente fue la elegida */
  @Prop({ default: 0 })
  avgConfidence: number;

  /** Veces que esta fuente produjo resultado correcto (sin corrección) */
  @Prop({ default: 0 })
  timesCorrect: number;
}

// ─── Sub-documento: historial de correcciones recientes ────────

export class CorrectionEntry {
  /** ID del ticket */
  @Prop({ required: true })
  ticketId: string;

  /** Campos que fueron corregidos */
  @Prop({ type: [String], default: [] })
  fieldsChanged: string[];

  /** Detalle por campo: { field, original, corrected } */
  @Prop({ type: [Object], default: [] })
  details: Array<{ field: string; original: any; corrected: any }>;

  @Prop({ required: true })
  correctedAt: Date;
}

// ─── Sub-documento: posición de precios en ticket ──────────────

export class PriceColumnInfo {
  /** Posición promedio del precio (% desde la derecha del ancho de línea) */
  @Prop({ default: 0 })
  avgPositionPct: number;

  /** Si los precios están alineados en columna fija */
  @Prop({ default: false })
  isFixedColumn: boolean;

  /** Carácter mínimo donde empieza el precio (para tickets de ancho fijo) */
  @Prop({ default: 0 })
  minCharPos: number;

  /** Separador más frecuente entre nombre y precio */
  @Prop({ default: 'spaces' })
  separator: string; // 'spaces' | 'dots' | 'dashes' | 'tabs'
}

// ═════════════════════════════════════════════════════════════════
// DOCUMENTO PRINCIPAL: template de ticket aprendido
// ═════════════════════════════════════════════════════════════════

export type TicketTemplateDocument = TicketTemplate & Document;

@Schema({ timestamps: true })
export class TicketTemplate {
  // ─── Identificación de tienda ────────────────────────────────

  @Prop({ required: true, index: true })
  storeName: string;

  @Prop({ type: [String], default: [] })
  storeAliases: string[];

  @Prop({ type: [String], default: [] })
  storePatterns: string[];

  @Prop({ required: true })
  ticketType: string;

  @Prop({ default: 'otros' })
  defaultCategory: string;

  // ─── Estructura del ticket ───────────────────────────────────

  @Prop({ type: [Object], default: [] })
  zones: ZonePattern[];

  @Prop({ type: [Object], default: [] })
  itemFormats: ItemLineFormat[];

  @Prop({ type: [Object], default: [] })
  totalPatterns: TotalLinePattern[];

  @Prop({ type: [String], default: [] })
  dateFormats: string[];

  @Prop({ type: [String], default: [] })
  headerKeywords: string[];

  @Prop({ type: [String], default: [] })
  footerKeywords: string[];

  @Prop({ type: [String], default: [] })
  excludePatterns: string[];

  @Prop({ default: 'generic' })
  preferredExtractor: string;

  @Prop({ default: 0 })
  avgLineCount: number;

  @Prop({ type: [Object], default: [] })
  sectionHeaders: Array<{ pattern: string; categoria: string }>;

  @Prop({ type: [String], default: [] })
  taxSuffixes: string[];

  /** Información sobre la posición de precios en el ticket */
  @Prop({ type: Object, default: null })
  priceColumn: PriceColumnInfo | null;

  /** Líneas promedio en zona de items (para detectar tickets truncados) */
  @Prop({ default: 0 })
  avgItemLineCount: number;

  /** Items promedio por ticket de esta tienda */
  @Prop({ default: 0 })
  avgItemCount: number;

  /** Total promedio de compra */
  @Prop({ default: 0 })
  avgTotal: number;

  // ─── Métricas globales ───────────────────────────────────────

  @Prop({ default: 0 })
  ticketsProcessed: number;

  @Prop({ default: 0 })
  ticketsCorrect: number;

  /** Precisión global (ticketsCorrect / ticketsProcessed) */
  @Prop({ default: 0 })
  accuracy: number;

  @Prop({ default: 0 })
  avgConfidence: number;

  @Prop({ default: 5 })
  maturityThreshold: number;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  lastTicketId: string;

  // ─── Accuracy por campo ──────────────────────────────────────

  @Prop({ type: [Object], default: [] })
  fieldAccuracy: FieldAccuracyStats[];

  // ─── Rendimiento por extractor ───────────────────────────────

  @Prop({ type: [Object], default: [] })
  extractorPerformance: ExtractorPerformance[];

  // ─── Rendimiento por fuente OCR ──────────────────────────────

  @Prop({ type: [Object], default: [] })
  ocrSourcePerformance: OcrSourcePerformance[];

  // ─── Historial de correcciones (últimas 20) ──────────────────

  @Prop({ type: [Object], default: [] })
  recentCorrections: CorrectionEntry[];

  // ─── Decay / relevancia temporal ─────────────────────────────

  /** Última fecha en que el decay se calculó */
  @Prop()
  lastDecayAt: Date;

  /** Factor de relevancia temporal (1 = reciente, decrece con el tiempo) */
  @Prop({ default: 1 })
  temporalRelevance: number;

  /** Fecha del último ticket procesado */
  @Prop()
  lastProcessedAt: Date;

  // ─── Meta ────────────────────────────────────────────────────

  @Prop({ default: 1 })
  version: number;
}

export const TicketTemplateSchema = SchemaFactory.createForClass(TicketTemplate);
TicketTemplateSchema.index({ storeName: 1 }, { unique: true });
TicketTemplateSchema.index({ ticketType: 1 });
TicketTemplateSchema.index({ isActive: 1, accuracy: -1 });
TicketTemplateSchema.index({ lastProcessedAt: -1 });
