import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type HistorialRecurrenteDocument = HistorialRecurrente & Document;

@Schema({ timestamps: true })
export class HistorialRecurrente {
  @Prop({ required: true })
  recurrenteId: string;

  @Prop({ required: true })
  monto: number;

  @Prop({ required: true })
  moneda: string;

  @Prop()
  montoConvertido?: number;

  @Prop()
  tasaConversion?: number;

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

  @Prop({ required: true, enum: ['exitoso', 'fallido', 'pausado', 'activo'] })
  estado: string;

  @Prop()
  mensajeError?: string;

  @Prop({ required: true })
  nombreRecurrente: string;

  @Prop({ type: Object })
  plataforma: {
    plataformaId: string;
    nombre: string;
    color: string;
    categoria: string;
  };
}

export const HistorialRecurrenteSchema = SchemaFactory.createForClass(HistorialRecurrente);
