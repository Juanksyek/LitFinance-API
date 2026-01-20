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
  monedaConvertida?: string;

  @Prop()
  montoConvertidoCuenta?: number;

  @Prop()
  monedaConvertidaCuenta?: string;

  @Prop()
  tasaConversionCuenta?: number;

  @Prop()
  montoConvertidoSubcuenta?: number;

  @Prop()
  monedaConvertidaSubcuenta?: string;

  @Prop()
  tasaConversionSubcuenta?: number;

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

  // Campos para planes de pago (plazo_fijo)
  @Prop()
  numeroPago?: number; // Ej. 3 de 12

  @Prop()
  totalPagos?: number; // Ej. 12

  @Prop()
  tipoRecurrente?: 'indefinido' | 'plazo_fijo'; // Para referencia
}

export const HistorialRecurrenteSchema = SchemaFactory.createForClass(HistorialRecurrente);
