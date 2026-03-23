import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SharedMovementSplitDocument = SharedMovementSplit & Document;

@Schema({ timestamps: true })
export class SharedMovementSplit {
  @Prop({ required: true, unique: true })
  splitId: string;

  @Prop({ required: true, index: true })
  movementId: string;

  @Prop({ required: true })
  memberId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ default: true })
  included: boolean;

  @Prop({ required: true })
  amountAssigned: number;

  @Prop()
  percentage: number;

  @Prop()
  units: number;

  @Prop({ enum: ['consumer', 'beneficiary', 'participant'], default: 'participant' })
  roleInSplit: string;
}

export const SharedMovementSplitSchema = SchemaFactory.createForClass(SharedMovementSplit);
SharedMovementSplitSchema.index({ movementId: 1 });
SharedMovementSplitSchema.index({ userId: 1 });
