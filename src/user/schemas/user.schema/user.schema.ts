import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ type: String, unique: true, required: true })
  id: string;

  @Prop({ required: true })
  nombreCompleto: string;

  @Prop({ required: true })
  edad: number;

  @Prop({ type: String, required: true })
  ocupacion: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ default: null })
  proveedor?: string;

  @Prop({ default: false })
  isActive: boolean;

  @Prop({ required: false })
  activationToken?: string;

  @Prop({ required: false })
  tokenExpires?: Date;

  @Prop({ type: String, required: false })
  resetCode?: string;

  @Prop({ type: Date, required: false })
  resetExpires?: Date;

  @Prop({ type: Date, default: Date.now })
  lastActivityAt: Date;

  @Prop({ type: [String], default: [] })
  expoPushTokens: string[];

  @Prop({ default: 'usuario' })
  rol: string;

  @Prop({ default: false })
  isPremium: boolean;

  // Moneda base del usuario - INMUTABLE después del registro
  @Prop({ required: true, immutable: true, default: 'MXN' })
  monedaPrincipal: string;

  // Moneda de visualización (puede cambiar) - solo afecta el UI
  @Prop({ required: false, default: 'MXN' })
  monedaPreferencia: string;

  @Prop({ type: [String], default: [] })
  monedasFavoritas: string[];

  @Prop({ required: false })
  telefono?: string;

  @Prop({ required: false })
  pais?: string;

  @Prop({ required: false })
  estado?: string;

  @Prop({ required: false })
  ciudad?: string;

  @Prop({ required: false })
  bio?: string;

  @Prop({ type: Date, default: null })
  ultimoReinicioIntentos: Date | null;

  @Prop({ type: Number, default: 3 }) // Campo para almacenar los intentos restantes
  intentosRestantes: number;

  // Campos de Stripe para Premium
  @Prop({ required: false })
  stripeCustomerId?: string;

  @Prop({ required: false })
  premiumSubscriptionId?: string;

  @Prop({ required: false })
  premiumSubscriptionStatus?: string; // 'active' | 'trialing' | 'canceled' | ...

  @Prop({ type: Date, required: false })
  premiumUntil?: Date; // para Jar (días regalados)
}

export const UserSchema = SchemaFactory.createForClass(User);
