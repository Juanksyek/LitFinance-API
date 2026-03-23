import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SharedNotificationDocument = SharedNotification & Document;

@Schema({ timestamps: true })
export class SharedNotification {
  @Prop({ required: true, unique: true })
  notificationId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ index: true })
  spaceId: string;

  @Prop({
    required: true,
    enum: [
      'invitation_received',
      'invitation_accepted',
      'invitation_rejected',
      'member_joined',
      'member_left',
      'member_removed',
      'role_changed',
      'movement_created',
      'movement_edited',
      'movement_cancelled',
      'contribution_added',
      'split_assigned',
      'impact_applied',
      'impact_reverted',
      'space_archived',
      'space_updated',
    ],
    index: true,
  })
  type: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ type: Object, default: {} })
  data: Record<string, any>;

  @Prop({ default: false, index: true })
  read: boolean;

  @Prop()
  readAt: Date;

  @Prop()
  actorUserId: string;
}

export const SharedNotificationSchema = SchemaFactory.createForClass(SharedNotification);
SharedNotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
SharedNotificationSchema.index({ userId: 1, createdAt: -1 });
