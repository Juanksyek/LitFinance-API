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
    enum: ['processing', 'completed', 'review', 'failed', 'cancelled'],
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
}

export const TicketScanSchema = SchemaFactory.createForClass(TicketScan);
TicketScanSchema.index({ userId: 1, fechaCompra: -1 });
TicketScanSchema.index({ userId: 1, estado: 1 });
TicketScanSchema.index({ userId: 1, tienda: 1 });
