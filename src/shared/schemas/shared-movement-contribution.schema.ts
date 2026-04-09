import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SharedMovementContributionDocument = SharedMovementContribution & Document;

@Schema({ timestamps: true })
export class SharedMovementContribution {
  @Prop({ required: true, unique: true })
  contributionId: string;

  @Prop({ required: true })
  movementId: string;

  @Prop({ required: true })
  memberId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  amountContributed: number;

  @Prop({ required: true, enum: ['payer', 'shared_source', 'manual'], default: 'payer' })
  contributionType: string;
}

export const SharedMovementContributionSchema = SchemaFactory.createForClass(SharedMovementContribution);
SharedMovementContributionSchema.index({ movementId: 1 });
SharedMovementContributionSchema.index({ userId: 1 });
