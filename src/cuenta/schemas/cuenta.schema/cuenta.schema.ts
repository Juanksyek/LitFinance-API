import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CuentaDocument = Cuenta & Document;

@Schema({ timestamps: true })
export class Cuenta {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  nombre: string;

  @Prop({ required: true })
  moneda: string;

  @Prop({ required: true })
  cantidad: number;

  @Prop()
  simbolo: string;

  @Prop()
  color: string;

  @Prop({ default: true })
  esPrincipal: boolean;
}

export const CuentaSchema = SchemaFactory.createForClass(Cuenta);
