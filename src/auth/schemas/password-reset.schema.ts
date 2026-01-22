import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PasswordResetDocument = PasswordReset & Document;

@Schema({ timestamps: true })
export class PasswordReset {
  @Prop({ required: true, lowercase: true, index: true })
  email: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  otpHash: string;

  @Prop({ required: true, index: true })
  expiresAt: Date;

  @Prop({ type: Number, default: 0 })
  attempts: number;

  @Prop({ type: Date, default: null })
  lockedUntil: Date | null;

  @Prop({ type: Date, default: null })
  consumedAt: Date | null;

  @Prop({ type: Date, default: null })
  lastSentAt: Date | null;

  @Prop({ type: Number, default: 0 })
  resendCount: number;
}

export const PasswordResetSchema = SchemaFactory.createForClass(PasswordReset);

// TTL (opcional): elimina docs expirados automáticamente.
// OJO: TTL funciona con campo Date y puede tardar en limpiar.
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Para queries típicas:
PasswordResetSchema.index({ email: 1, consumedAt: 1, expiresAt: 1 });
