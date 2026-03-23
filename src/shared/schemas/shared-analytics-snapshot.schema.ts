import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SharedAnalyticsSnapshotDocument = SharedAnalyticsSnapshot & Document;

@Schema({ timestamps: true })
export class SharedAnalyticsSnapshot {
  @Prop({ required: true, unique: true })
  snapshotId: string;

  @Prop({ required: true, index: true })
  spaceId: string;

  @Prop({ required: true, enum: ['week', 'month', 'quarter', 'year'] })
  periodType: string;

  @Prop({ required: true })
  periodStart: Date;

  @Prop({ required: true })
  periodEnd: Date;

  @Prop({ required: true })
  currency: string;

  @Prop({ type: Object, required: true })
  metrics: Record<string, any>;

  @Prop({ required: true })
  generatedAt: Date;
}

export const SharedAnalyticsSnapshotSchema = SchemaFactory.createForClass(SharedAnalyticsSnapshot);
SharedAnalyticsSnapshotSchema.index({ spaceId: 1, periodType: 1, periodStart: -1 });
