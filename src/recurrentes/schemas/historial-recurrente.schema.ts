import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type HistorialRecurrenteDocument = HistorialRecurrente & Document;

@Schema({ timestamps: true })
export class HistorialRecurrente {
  @Prop({ required: true })
  recurrenteId: string;

  @Prop({ required: true })
  monto: number;

  @Prop()
  cuentaId?: string;

  @Prop()
  subcuentaId?: string;

  @Prop({ required: true })
  afectaCuentaPrincipal: boolean;

  @Prop({ required: true })
  fecha: Date;

  @Prop({ required: true })
  userId: string;
}

export const HistorialRecurrenteSchema = SchemaFactory.createForClass(HistorialRecurrente);
