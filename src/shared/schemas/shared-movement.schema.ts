import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SharedMovementDocument = SharedMovement & Document;

@Schema({ timestamps: true })
export class SharedMovement {
  @Prop({ required: true, unique: true })
  movementId: string;

  @Prop({ required: true, index: true })
  spaceId: string;

  @Prop({ required: true, index: true })
  createdByUserId: string;

  @Prop({ required: true })
  createdByMemberId: string;

  @Prop({
    required: true,
    enum: ['expense', 'income', 'adjustment', 'planned', 'recurring', 'goal_contribution'],
    index: true,
  })
  tipo: string;

  @Prop({ required: true })
  titulo: string;

  @Prop({ default: '' })
  descripcion: string;

  @Prop({ index: true })
  categoriaId: string;

  @Prop({ required: true })
  montoTotal: number;

  @Prop({ required: true })
  moneda: string;

  @Prop({ required: true, index: true })
  fechaMovimiento: Date;

  @Prop({
    required: true,
    enum: ['equal', 'percentage', 'fixed', 'participants_only', 'units', 'custom'],
    default: 'equal',
  })
  splitMode: string;

  @Prop({ enum: ['all', 'limited', 'private_summary'], default: 'all' })
  visibility: string;

  @Prop({
    required: true,
    enum: ['draft', 'published', 'cancelled', 'corrected'],
    default: 'published',
    index: true,
  })
  estado: string;

  @Prop()
  notes: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop()
  linkedRuleId: string;

  @Prop({ default: false })
  hasAccountImpact: boolean;

  @Prop()
  cancelledAt: Date;

  @Prop()
  cancelledBy: string;

  @Prop()
  idempotencyKey: string;
}

export const SharedMovementSchema = SchemaFactory.createForClass(SharedMovement);
SharedMovementSchema.index({ spaceId: 1, fechaMovimiento: -1 });
SharedMovementSchema.index({ spaceId: 1, estado: 1 });
SharedMovementSchema.index({ spaceId: 1, categoriaId: 1 });
SharedMovementSchema.index({ spaceId: 1, createdByUserId: 1 });
SharedMovementSchema.index({ spaceId: 1, tipo: 1 });
SharedMovementSchema.index({ idempotencyKey: 1, spaceId: 1 }, { unique: true, sparse: true });
