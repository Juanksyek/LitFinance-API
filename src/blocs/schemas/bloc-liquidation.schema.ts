import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BlocLiquidationDocument = BlocLiquidation & Document;

@Schema({ _id: false })
export class BlocLiquidationItemSnapshot {
  @Prop({ required: true })
  itemId: string;

  @Prop({ required: true })
  monedaOriginal: string;

  // Lo que se liquidó en moneda original en ESTA liquidación
  @Prop({ required: true })
  montoOriginalPagado: number;

  @Prop()
  rateUsed?: number;

  @Prop()
  rateAsOf?: Date;

  @Prop({ required: true })
  convertedAmount: number;

  @Prop({ required: true })
  monedaDestino: string;

  @Prop()
  roundingDiff?: number;
}

@Schema({ _id: false })
export class BlocLiquidationTotals {
  @Prop({ type: Object, default: {} })
  totalOriginalByCurrency: Record<string, number>;

  @Prop({ required: true })
  totalConverted: number;
}

@Schema({ timestamps: true })
export class BlocLiquidation {
  @Prop({ required: true, unique: true })
  liquidationId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  blocId: string;

  @Prop({ required: true, enum: ['principal', 'cuenta', 'subcuenta'] })
  targetType: 'principal' | 'cuenta' | 'subcuenta';

  @Prop({ required: true })
  targetId: string;

  @Prop({ required: true })
  targetCurrency: string;

  @Prop({ type: [BlocLiquidationItemSnapshot], default: [] })
  items: BlocLiquidationItemSnapshot[];

  @Prop({ type: BlocLiquidationTotals, required: true })
  totals: BlocLiquidationTotals;

  @Prop({ type: [String], default: [] })
  createdTransactionIds: string[];

  @Prop({ required: true, enum: ['processing', 'done', 'failed'], default: 'processing' })
  status: 'processing' | 'done' | 'failed';

  @Prop()
  idempotencyKey?: string;

  @Prop()
  note?: string;

  @Prop({ type: Object, default: null })
  error?: Record<string, any>;
}

export const BlocLiquidationSchema = SchemaFactory.createForClass(BlocLiquidation);

BlocLiquidationSchema.index({ userId: 1, blocId: 1, createdAt: -1 });
BlocLiquidationSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
