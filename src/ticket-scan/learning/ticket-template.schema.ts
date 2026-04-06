import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// ─── Sub-documento: patrón de zona del ticket ──────────────────

export class ZonePattern {
  /** Nombre de la zona (header, items, totals, footer) */
  @Prop({ required: true })
  zone: string;

  /** Rango de líneas típico [inicio%, fin%] respecto al total de líneas */
  @Prop({ type: [Number], default: [0, 100] })
  lineRange: number[];

  /** Patrones regex que suelen aparecer en esta zona */
  @Prop({ type: [String], default: [] })
  patterns: string[];

  /** Palabras clave frecuentes en esta zona */
  @Prop({ type: [String], default: [] })
  keywords: string[];
}

// ─── Sub-documento: formato de línea de item ───────────────────

export class ItemLineFormat {
  /** Nombre descriptivo del formato (qty_x_price, name_price, barcode_name_price, etc.) */
  @Prop({ required: true })
  name: string;

  /** Regex que captura los items en este formato */
  @Prop({ required: true })
  regex: string;

  /** Grupos de captura: [nombre, cantidad, precioUnitario, subtotal] */
  @Prop({ type: [String], default: [] })
  captureGroups: string[];

  /** Porcentaje de items que matchean con este formato (0-1) */
  @Prop({ default: 0 })
  matchRate: number;

  /** Número de tickets donde este formato fue usado con éxito */
  @Prop({ default: 0 })
  successCount: number;
}

// ─── Sub-documento: patrón de totales ──────────────────────────

export class TotalLinePattern {
  /** Campo (subtotal, iva, ieps, total, descuento, propina) */
  @Prop({ required: true })
  field: string;

  /** Etiquetas que identifican esta línea (e.g. "SUBTOTAL", "SUB TOTAL", "Sub-Total") */
  @Prop({ type: [String], default: [] })
  labels: string[];

  /** Posición típica relativa al final del ticket (% desde abajo) */
  @Prop({ default: 0 })
  positionFromBottom: number;
}

// ─── Documento principal: template de ticket aprendido ─────────

export type TicketTemplateDocument = TicketTemplate & Document;

@Schema({ timestamps: true })
export class TicketTemplate {
  /** Nombre normalizado de la tienda (key principal de matching) */
  @Prop({ required: true, index: true })
  storeName: string;

  /** Alias / variantes del nombre detectadas por OCR */
  @Prop({ type: [String], default: [] })
  storeAliases: string[];

  /** Patrones regex para detectar esta tienda (aprendidos del texto OCR) */
  @Prop({ type: [String], default: [] })
  storePatterns: string[];

  /** Tipo de ticket: supermercado, restaurante, farmacia, etc. */
  @Prop({ required: true })
  ticketType: string;

  /** Categoría por defecto para items de esta tienda */
  @Prop({ default: 'otros' })
  defaultCategory: string;

  /** Zonas estructurales del ticket */
  @Prop({ type: [Object], default: [] })
  zones: ZonePattern[];

  /** Formatos de línea de item que funcionan para esta tienda */
  @Prop({ type: [Object], default: [] })
  itemFormats: ItemLineFormat[];

  /** Patrones de líneas de totales */
  @Prop({ type: [Object], default: [] })
  totalPatterns: TotalLinePattern[];

  /** Formato de fecha detectado (DD/MM/YYYY, DDMon'YY, etc.) */
  @Prop({ type: [String], default: [] })
  dateFormats: string[];

  /** Palabras clave del header (primeras líneas) que identifican la tienda */
  @Prop({ type: [String], default: [] })
  headerKeywords: string[];

  /** Palabras clave del footer que son recurrentes */
  @Prop({ type: [String], default: [] })
  footerKeywords: string[];

  /** Líneas de exclusión específicas de esta tienda (separadores, publicidad, etc.) */
  @Prop({ type: [String], default: [] })
  excludePatterns: string[];

  /** Extractor preferido (supermarket, restaurant, generic) */
  @Prop({ default: 'generic' })
  preferredExtractor: string;

  // ─── Métricas de rendimiento ─────────────────────────────────

  /** Número de tickets procesados que usaron este template */
  @Prop({ default: 0 })
  ticketsProcessed: number;

  /** Número de tickets donde el usuario NO corrigió nada */
  @Prop({ default: 0 })
  ticketsCorrect: number;

  /** Precisión del template (ticketsCorrect / ticketsProcessed) */
  @Prop({ default: 0 })
  accuracy: number;

  /** Confianza promedio cuando se usa este template */
  @Prop({ default: 0 })
  avgConfidence: number;

  /** Número mínimo de tickets procesados para considerar el template maduro */
  @Prop({ default: 3 })
  maturityThreshold: number;

  /** Si el template está activo y se usa en el pipeline */
  @Prop({ default: true })
  isActive: boolean;

  /** Último ticket que contribuyó a este template */
  @Prop()
  lastTicketId: string;

  /** Cantidad de líneas promedio del ticket */
  @Prop({ default: 0 })
  avgLineCount: number;

  /** Secciones de categoría detectadas (ABARROTES, CARNES, etc.) */
  @Prop({ type: [Object], default: [] })
  sectionHeaders: Array<{ pattern: string; categoria: string }>;

  /** Sufijos de impuestos detectados (T=tasa 0, E=exento, etc.) */
  @Prop({ type: [String], default: [] })
  taxSuffixes: string[];

  /** Versión del template (incrementa con cada aprendizaje) */
  @Prop({ default: 1 })
  version: number;
}

export const TicketTemplateSchema = SchemaFactory.createForClass(TicketTemplate);
TicketTemplateSchema.index({ storeName: 1 }, { unique: true });
TicketTemplateSchema.index({ ticketType: 1 });
TicketTemplateSchema.index({ isActive: 1, accuracy: -1 });
