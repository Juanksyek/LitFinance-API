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

  @Prop({ default: 'usuario' })
  rol: string;

  @Prop({ default: false })
  isPremium: boolean;

  @Prop({ required: false, default: 'USD' })  // Cambiado a optional con default
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
}

export const UserSchema = SchemaFactory.createForClass(User);
// Exportar el esquema