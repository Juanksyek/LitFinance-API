import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type InternalTransferDocument = InternalTransfer & Document;

export const ORIGEN_DESTINO_TIPOS = ['cuenta', 'subcuenta'] as const;
export type OrigenDestinoTipo = (typeof ORIGEN_DESTINO_TIPOS)[number];

@Schema({ timestamps: true })
export class InternalTransfer {
  @Prop({ type: String, required: true, index: true })
  userId: string;

  @Prop({ type: String, required: true, unique: true })
  txId: string;

  // ✅ opcional, sin union; si no existe, no se guarda (undefined)
  @Prop({ type: String, default: undefined })
  idempotencyKey?: string;

  @Prop({ type: Number, required: true })
  montoOrigen: number;

  @Prop({ type: String, required: true })
  monedaOrigen: string;

  @Prop({ type: Number, required: true })
  montoDestino: number;

  @Prop({ type: String, required: true })
  monedaDestino: string;

  @Prop({ type: Number, default: undefined })
  tasaConversion?: number;

  @Prop({ type: Date, default: undefined })
  fechaConversion?: Date;

  @Prop({ type: String, required: true, enum: ORIGEN_DESTINO_TIPOS })
  origenTipo: OrigenDestinoTipo;

  @Prop({ type: String, required: true })
  origenId: string;

  @Prop({ type: String, required: true, enum: ORIGEN_DESTINO_TIPOS })
  destinoTipo: OrigenDestinoTipo;

  @Prop({ type: String, required: true })
  destinoId: string;

  @Prop({ type: String, default: undefined })
  motivo?: string;

  // Guardamos saldos resultantes para respuesta idempotente
  @Prop({ type: Number, required: true })
  saldoOrigenDespues: number;

  @Prop({ type: Number, required: true })
  saldoDestinoDespues: number;
}

export const InternalTransferSchema = SchemaFactory.createForClass(InternalTransfer);

InternalTransferSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true },
);
