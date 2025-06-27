import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PlataformaRecurrenteDocument = PlataformaRecurrente & Document;

@Schema()
export class PlataformaRecurrente {
  @Prop({ required: true, unique: true })
  nombre: string;

  @Prop({ required: true, unique: true })
  plataformaId: string;

  @Prop()
  categoria?: string;

  @Prop()
  color?: string;
}

export const PlataformaRecurrenteSchema = SchemaFactory.createForClass(PlataformaRecurrente);
