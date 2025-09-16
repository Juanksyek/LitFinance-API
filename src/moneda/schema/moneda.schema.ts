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
}

export const MonedaSchema = SchemaFactory.createForClass(Moneda);