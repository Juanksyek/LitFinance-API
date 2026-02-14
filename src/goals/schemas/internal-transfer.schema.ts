import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type InternalTransferDocument = InternalTransfer & Document;

@Schema({ timestamps: true })
export class InternalTransfer {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, unique: true })
  txId: string;

  @Prop({ default: null })
  idempotencyKey?: string | null;

  @Prop({ required: true })
  montoOrigen: number;

  @Prop({ required: true })
  monedaOrigen: string;

  @Prop({ required: true })
  montoDestino: number;

  @Prop({ required: true })
  monedaDestino: string;

  @Prop({ default: null })
  tasaConversion?: number | null;

  @Prop({ default: null })
  fechaConversion?: Date | null;

  @Prop({ required: true })
  origenTipo: 'cuenta' | 'subcuenta';

  @Prop({ required: true })
  origenId: string;

  @Prop({ required: true })
  destinoTipo: 'cuenta' | 'subcuenta';

  @Prop({ required: true })
  destinoId: string;

  @Prop({ default: null })
  motivo?: string | null;

  // Guardamos saldos resultantes para respuesta idempotente
  @Prop({ required: true })
  saldoOrigenDespues: number;

  @Prop({ required: true })
  saldoDestinoDespues: number;
}

export const InternalTransferSchema = SchemaFactory.createForClass(InternalTransfer);

InternalTransferSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
