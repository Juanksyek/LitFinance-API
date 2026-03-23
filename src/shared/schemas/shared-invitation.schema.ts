import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SharedInvitationDocument = SharedInvitation & Document;

@Schema({ timestamps: true })
export class SharedInvitation {
  @Prop({ required: true, unique: true })
  invitationId: string;

  @Prop({ required: true, index: true })
  spaceId: string;

  @Prop({ required: true })
  createdBy: string;

  @Prop({ index: true })
  invitedUserId: string;

  @Prop()
  email: string;

  /** Tipo de invitación: direct (por userId), email, link (URL/QR abierta) */
  @Prop({ required: true, enum: ['direct', 'email', 'link'], default: 'direct' })
  invitationType: string;

  /** Token en claro — NUNCA se persiste. Solo se usa transitoriamente para generar shareUrl. */
  @Prop({ required: true, unique: true, index: true })
  token: string;

  /** SHA-256 hash del token (para verificación sin exponer el token raw en DB exports) */
  @Prop()
  tokenHash: string;

  /** URL compartible generada por el backend */
  @Prop()
  shareUrl: string;

  /** Rol asignado al aceptar */
  @Prop({ enum: ['admin', 'member'], default: 'member' })
  rol: string;

  /** Mensaje personal del invitador */
  @Prop()
  message: string;

  /** Si la invitación link puede ser usada por múltiples personas */
  @Prop({ default: false })
  multiUse: boolean;

  /** Cantidad de veces aceptada (para multiUse) */
  @Prop({ default: 0 })
  acceptedCount: number;

  /** Límite de aceptaciones para links multiUse (0 = sin límite) */
  @Prop({ default: 0 })
  maxUses: number;

  @Prop({ required: true, enum: ['pending', 'accepted', 'rejected', 'expired', 'revoked'], default: 'pending', index: true })
  estado: string;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop()
  acceptedAt: Date;
}

export const SharedInvitationSchema = SchemaFactory.createForClass(SharedInvitation);
SharedInvitationSchema.index({ spaceId: 1, estado: 1 });
SharedInvitationSchema.index({ invitedUserId: 1, estado: 1 });
SharedInvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
