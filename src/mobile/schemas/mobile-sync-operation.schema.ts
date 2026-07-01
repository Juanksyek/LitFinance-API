import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { MOBILE_SYNC_OPERATION_TYPES } from '../dto/mobile-sync-push.dto';

export type MobileSyncOperationDocument = MobileSyncOperation & Document;

export const MOBILE_SYNC_RESULT_STATUSES = [
  'success',
  'failed',
  'retryable',
  'conflict',
  'rejected',
] as const;

export type MobileSyncResultStatus =
  (typeof MOBILE_SYNC_RESULT_STATUSES)[number];

@Schema({ timestamps: true })
export class MobileSyncOperation {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  deviceId: string;

  @Prop({ required: true })
  operationId: string;

  @Prop({ required: true, enum: MOBILE_SYNC_OPERATION_TYPES, index: true })
  type: string;

  @Prop({ type: Object, required: true })
  requestPayload: Record<string, unknown>;

  @Prop({ type: Object, required: true })
  responsePayload: Record<string, unknown>;

  @Prop({ required: true, enum: MOBILE_SYNC_RESULT_STATUSES, index: true })
  status: MobileSyncResultStatus;

  @Prop({ type: Date, required: true })
  clientCreatedAt: Date;

  @Prop({ type: Date, required: true })
  processedAt: Date;
}

export const MobileSyncOperationSchema =
  SchemaFactory.createForClass(MobileSyncOperation);

MobileSyncOperationSchema.index(
  { userId: 1, deviceId: 1, operationId: 1 },
  { unique: true },
);
