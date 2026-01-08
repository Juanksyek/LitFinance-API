import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserSessionDocument = UserSession & Document;

@Schema({ timestamps: true })
export class UserSession {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  deviceId: string;

  @Prop({ required: true })
  jti: string;

  @Prop({ required: true })
  refreshHash: string;

  @Prop({ default: false, index: true })
  revoked: boolean;

  @Prop({ required: true, index: true })
  expiresAt: Date;

  @Prop()
  lastUsedAt?: Date;
}

export const UserSessionSchema = SchemaFactory.createForClass(UserSession);
UserSessionSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
