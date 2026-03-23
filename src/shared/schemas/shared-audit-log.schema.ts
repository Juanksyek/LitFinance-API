import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SharedAuditLogDocument = SharedAuditLog & Document;

@Schema({ timestamps: true })
export class SharedAuditLog {
  @Prop({ required: true, unique: true })
  auditId: string;

  @Prop({ required: true, index: true })
  spaceId: string;

  @Prop({ index: true })
  movementId: string;

  @Prop({ required: true })
  entityType: string;

  @Prop({ required: true })
  entityId: string;

  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  actorUserId: string;

  @Prop()
  actorMemberId: string;

  @Prop({ type: Object })
  payloadBefore: Record<string, any>;

  @Prop({ type: Object })
  payloadAfter: Record<string, any>;

  @Prop({ type: Object })
  metadata: Record<string, any>;
}

export const SharedAuditLogSchema = SchemaFactory.createForClass(SharedAuditLog);
SharedAuditLogSchema.index({ spaceId: 1, createdAt: -1 });
SharedAuditLogSchema.index({ entityType: 1, entityId: 1 });
SharedAuditLogSchema.index({ actorUserId: 1 });
