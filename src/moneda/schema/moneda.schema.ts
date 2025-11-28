import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MonedaDocument = Moneda & Document;

@Schema()
export class Moneda {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, unique: true })
  codigo: string;

  @Prop({ required: true })
  nombre: string;

  @Prop({ required: true })
  simbolo: string;

  @Prop({ default: false })
  isPrincipal: boolean;

  // Tasa de conversión respecto a MXN (moneda base del sistema)
  // Ejemplo: Si 1 USD = 17.5 MXN, entonces tasaBase = 17.5
  @Prop({ required: true, default: 1 })
  tasaBase: number;

  // Fecha de última actualización de la tasa
  @Prop({ default: Date.now })
  ultimaActualizacion: Date;
}

export const MonedaSchema = SchemaFactory.createForClass(Moneda);