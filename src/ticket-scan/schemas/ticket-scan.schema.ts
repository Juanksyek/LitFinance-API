import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// ─── Sub-documento: artículo del ticket ────────────────────────

export class TicketItem {
  @Prop({ required: true })
  nombre: string;

  @Prop({ required: true })
  cantidad: number; // unidades compradas

  @Prop({ required: true })
  precioUnitario: number;

  @Prop({ required: true })
  subtotal: number;

  /** Categoría deducida por IA: alimentos, transporte, hogar, salud, entretenimiento, ropa, educacion, servicios, otros */
  @Prop({ required: true, default: 'otros' })
  categoria: string;

  /** Confianza de la categorización (0-1) */
  @Prop({ default: 1 })
  confianza: number;

  /** Componentes / detalles adicionales del artículo (ej. ingredientes de combo, modificadores) */
  @Prop({ type: [String], default: [] })
  detalles: string[];
}

// ─── Documento principal: ticket escaneado ─────────────────────

export type TicketScanDocument = TicketScan & Document;

@Schema({ timestamps: true })
export class TicketScan {
  @Prop({ required: true, unique: true })
  ticketId: string;

  @Prop({ required: true, index: true })
  userId: string;

  /** Nombre de la tienda/comercio extraído del ticket */
  @Prop({ required: true })
  tienda: string;

  /** Dirección del comercio (si aparece en el ticket) */
  @Prop()
  direccionTienda: string;

  /** Fecha de compra extraída del ticket */
  @Prop({ required: true })
  fechaCompra: Date;

  /** Artículos desglosados */
  @Prop({ type: [Object], default: [] })
  items: TicketItem[];

  /** Subtotal antes de impuestos */
  @Prop({ required: true })
  subtotal: number;

  /** Impuestos totales */
  @Prop({ default: 0 })
  impuestos: number;

  /** Descuentos aplicados (valor positivo) */
  @Prop({ default: 0 })
  descuentos: number;

  /** Propina (si aplica) */
  @Prop({ default: 0 })
  propina: number;

  /** Total final del ticket */
  @Prop({ required: true })
  total: number;

  /** Moneda del ticket */
  @Prop({ required: true, default: 'MXN' })
  moneda: string;

  /** Método de pago detectado (efectivo, tarjeta, etc.) */
  @Prop()
  metodoPago: string;

  /** ID de la transacción creada automáticamente */
  @Prop({ index: true })
  transaccionId: string;

  /** Estado del procesamiento */
  @Prop({
    required: true,
    enum: ['processing', 'completed', 'review', 'failed', 'cancelled', 'liquidado'],
    default: 'processing',
    index: true,
  })
  estado: string;

  /** Si el usuario ya revisó/confirmó los datos extraídos */
  @Prop({ default: false })
  confirmado: boolean;

  /** Imagen del ticket en base64 (JPEG/PNG) */
  @Prop()
  imagenBase64: string;

  /** MIME type de la imagen (image/jpeg, image/png) */
  @Prop()
  imagenMimeType: string;

  /** Texto crudo extraído por OCR (para debug/re-procesamiento) */
  @Prop()
  ocrTextoRaw: string;

  /** JSON crudo de cada proveedor OCR (Azure, OCR.space, Python worker, etc.) — para dataset/training */
  @Prop({ type: [Object], default: [] })
  ocrProvidersRaw: Array<{
    provider: string;
    variant: string;
    rawJson: string;
    overallConfidence: number;
  }>;

  /** Candidatos OCR crudos rankeados del Python worker */
  @Prop({ type: [Object], default: [] })
  ocrRawCandidates: Array<{
    source: string;
    variant: string;
    score: number;
    amountsDetected: number;
    wordsDetected: number;
  }>;

  /** Fuente del mejor candidato OCR (paddle:contrast, tesseract:grayscale, etc.) */
  @Prop()
  ocrBestSource: string;

  /** Texto OCR enviado por el front (ML Kit / Apple Vision) */
  @Prop()
  ocrFrontText: string;

  /** Texto OCR del backend (mejor candidato del worker) */
  @Prop()
  ocrBackText: string;

  /** Confianza global del OCR (0-1) */
  @Prop({ type: Number, default: 0 })
  ocrConfidence: number;

  /** Variantes de imagen generadas por OpenCV */
  @Prop({ type: [String], default: [] })
  imageVariants: string[];

  /** Si el ticket requiere revisión humana */
  @Prop({ default: true })
  needsReview: boolean;

  /** Versión del pipeline de procesamiento (para re-procesamiento futuro) */
  @Prop({ default: '2.0.0' })
  processingVersion: string;

  /** Tipo de ticket detectado (supermercado, restaurante, etc.) */
  @Prop()
  tipoTicket: string;

  /** Nombre del extractor que ganó (supermarket, restaurant, generic) */
  @Prop()
  extractorUsed: string;

  /** Score del mejor candidato OCR */
  @Prop({ type: Number, default: 0 })
  ocrScore: number;

  /** Confianza por campo { tienda: 0.9, fecha: 0.8, items: 0.7, ... } */
  @Prop({ type: Object, default: {} })
  fieldConfidence: Record<string, number>;

  /** Nivel de revisión sugerido: auto | light | full | manual */
  @Prop({ default: 'full' })
  reviewLevel: string;

  /** Correcciones del usuario (para entrenamiento continuo) */
  @Prop({ type: Object })
  userCorrections: {
    tiendaOriginal?: string;
    fechaOriginal?: string;
    totalOriginal?: number;
    subtotalOriginal?: number;
    impuestosOriginal?: number;
    itemsOriginal?: number; // cantidad de items antes de edición
    correctedAt?: Date;
  };

  /** Si los datos procesados fueron corregidos por el usuario */
  @Prop({ default: false })
  wasUserCorrected: boolean;

  /** Notas del usuario */
  @Prop()
  notas: string;

  /** Resumen de categorías: { alimentos: 150.5, transporte: 30, ... } */
  @Prop({ type: Object, default: {} })
  resumenCategorias: Record<string, number>;

  /** Cuenta afectada */
  @Prop()
  cuentaId: string;

  /** Subcuenta afectada (opcional) */
  @Prop()
  subCuentaId: string;

  /** Campos de liquidación */
  @Prop({ default: 0 })
  montoLiquidado: number;

  @Prop()
  liquidadoPorCuenta?: string;

  @Prop()
  liquidadoPorSubcuenta?: string;

  @Prop()
  fechaLiquidacion?: Date;

  @Prop()
  liquidadoPorUsuario?: string;
}

export const TicketScanSchema = SchemaFactory.createForClass(TicketScan);
TicketScanSchema.index({ userId: 1, fechaCompra: -1 });
TicketScanSchema.index({ userId: 1, estado: 1 });
TicketScanSchema.index({ userId: 1, tienda: 1 });
