import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MetaEventoDocument = MetaEvento & Document;

export type MetaEventoTipo = 'aporte' | 'retiro' | 'ajuste' | 'auto_aporte';

@Schema({ timestamps: true })
export class MetaEvento {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  metaId: string;

  @Prop({ required: true, index: true })
  txId: string;

  @Prop({ required: true })
  tipo: MetaEventoTipo;

  // Monto en la moneda ORIGEN (input). Para aportes/retiros usamos moneda del origen.
  @Prop({ required: true })
  monto: number;

  @Prop({ required: true })
  moneda: string;

  // Si hubo conversión a la subcuenta meta, guardamos el monto destino
  @Prop({ default: null })
  montoDestino?: number | null;

  @Prop({ default: null })
  monedaDestino?: string | null;

  @Prop({ default: null })
  tasaConversion?: number | null;

  @Prop({ default: null })
  fechaConversion?: Date | null;

  @Prop({ default: null })
  origenTipo?: 'cuenta' | 'subcuenta' | null;

  @Prop({ default: null })
  origenId?: string | null;

  @Prop({ default: null })
  destinoTipo?: 'cuenta' | 'subcuenta' | null;

  @Prop({ default: null })
  destinoId?: string | null;

  @Prop({ default: null })
  nota?: string | null;

  // Idempotencia por operación de dinero (append-only)
  @Prop({ default: null })
  idempotencyKey?: string | null;
}

export const MetaEventoSchema = SchemaFactory.createForClass(MetaEvento);

MetaEventoSchema.index({ userId: 1, metaId: 1, createdAt: -1 });
MetaEventoSchema.index({ userId: 1, metaId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
