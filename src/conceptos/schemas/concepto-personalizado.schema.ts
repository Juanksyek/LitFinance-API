import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ConceptoPersonalizadoDocument = ConceptoPersonalizado & Document;

@Schema({ timestamps: true })
export class ConceptoPersonalizado {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, unique: true })
  conceptoId: string;

  @Prop({ required: true })
  nombre: string;

  @Prop({ required: true })
  color: string;

  @Prop()
  icono?: string;
}

export const ConceptoPersonalizadoSchema = SchemaFactory.createForClass(ConceptoPersonalizado);
