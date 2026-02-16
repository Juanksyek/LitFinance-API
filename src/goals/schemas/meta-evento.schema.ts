import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MetaEventoDocument = MetaEvento & Document;

export const META_EVENTO_TIPOS = ['aporte', 'retiro', 'ajuste', 'auto_aporte'] as const;
export type MetaEventoTipo = (typeof META_EVENTO_TIPOS)[number];

export const META_ORIGEN_DESTINO_TIPOS = ['cuenta', 'subcuenta'] as const;
export type OrigenDestinoTipo = (typeof META_ORIGEN_DESTINO_TIPOS)[number];

@Schema({ timestamps: true })
export class MetaEvento {
  @Prop({ type: String, required: true, index: true })
  userId: string;

  @Prop({ type: String, required: true, index: true })
  metaId: string;

  @Prop({ type: String, required: true, index: true })
  txId: string;

  @Prop({ type: String, required: true, enum: META_EVENTO_TIPOS })
  tipo: MetaEventoTipo;

  // Monto en la moneda ORIGEN (input). Para aportes/retiros usamos moneda del origen.
  @Prop({ type: Number, required: true })
  monto: number;

  @Prop({ type: String, required: true })
  moneda: string;

  // Si hubo conversión a la subcuenta meta, guardamos el monto destino
  @Prop({ type: Number, default: undefined })
  montoDestino?: number;

  @Prop({ type: String, default: undefined })
  monedaDestino?: string;

  @Prop({ type: Number, default: undefined })
  tasaConversion?: number;

  @Prop({ type: Date, default: undefined })
  fechaConversion?: Date;

  @Prop({ type: String, enum: META_ORIGEN_DESTINO_TIPOS, default: undefined })
  origenTipo?: OrigenDestinoTipo;

  @Prop({ type: String, default: undefined })
  origenId?: string;

  @Prop({ type: String, enum: META_ORIGEN_DESTINO_TIPOS, default: undefined })
  destinoTipo?: OrigenDestinoTipo;

  @Prop({ type: String, default: undefined })
  destinoId?: string;

  @Prop({ type: String, default: undefined })
  nota?: string;

  // Idempotencia por operación de dinero (append-only)
  @Prop({ type: String, default: undefined })
  idempotencyKey?: string;
}

export const MetaEventoSchema = SchemaFactory.createForClass(MetaEvento);

MetaEventoSchema.index({ userId: 1, metaId: 1, createdAt: -1 });
MetaEventoSchema.index(
  { userId: 1, metaId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true },
);
