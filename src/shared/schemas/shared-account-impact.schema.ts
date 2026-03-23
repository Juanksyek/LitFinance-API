import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SharedAccountImpactDocument = SharedAccountImpact & Document;

@Schema({ timestamps: true })
export class SharedAccountImpact {
  @Prop({ required: true, unique: true })
  impactId: string;

  @Prop({ required: true, index: true })
  movementId: string;

  @Prop({ required: true, index: true })
  spaceId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  memberId: string;

  @Prop({ required: true, enum: ['main_account', 'subaccount'] })
  destinationType: string;

  @Prop({ required: true })
  destinationId: string;

  @Prop({ required: true, enum: ['income', 'expense', 'adjustment'] })
  impactType: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  moneda: string;

  @Prop({ default: true })
  afectaSaldo: boolean;

  @Prop()
  transactionId: string;

  @Prop()
  historyId: string;

  @Prop({
    required: true,
    enum: ['pending', 'applied', 'reverted', 'failed', 'outdated'],
    default: 'pending',
    index: true,
  })
  status: string;

  @Prop()
  appliedAt: Date;

  @Prop()
  revertedAt: Date;

  @Prop()
  errorMessage: string;

  @Prop({ type: Object })
  conversionMeta: {
    monedaOrigen?: string;
    monedaDestino?: string;
    tasaConversion?: number;
    montoConvertido?: number;
    fechaConversion?: Date;
  };
}

export const SharedAccountImpactSchema = SchemaFactory.createForClass(SharedAccountImpact);
SharedAccountImpactSchema.index({ movementId: 1, userId: 1 });
SharedAccountImpactSchema.index({ userId: 1, status: 1 });
SharedAccountImpactSchema.index({ destinationType: 1, destinationId: 1 });
