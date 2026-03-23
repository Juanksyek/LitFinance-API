import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SharedSplitRuleDocument = SharedSplitRule & Document;

@Schema({ timestamps: true })
export class SharedSplitRule {
  @Prop({ required: true, unique: true })
  ruleId: string;

  @Prop({ required: true, index: true })
  spaceId: string;

  @Prop({ required: true })
  nombre: string;

  @Prop({
    required: true,
    enum: ['equal', 'percentage', 'fixed', 'units', 'participants_only', 'custom'],
  })
  tipo: string;

  @Prop({ enum: ['default', 'category', 'movement_template'], default: 'default' })
  scope: string;

  @Prop({ type: Object, default: {} })
  config: Record<string, any>;

  @Prop({ enum: ['active', 'archived'], default: 'active' })
  estado: string;

  @Prop({ required: true })
  createdBy: string;
}

export const SharedSplitRuleSchema = SchemaFactory.createForClass(SharedSplitRule);
SharedSplitRuleSchema.index({ spaceId: 1, estado: 1 });
