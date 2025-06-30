import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CuentaHistorialDocument = CuentaHistorial & Document;

@Schema({ timestamps: true })
export class CuentaHistorial {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  cuentaId: string;

  @Prop({ required: true })
  monto: number;

  @Prop({
    required: true,
    enum: ['ingreso', 'egreso', 'ajuste_subcuenta', 'recurrente', 'cambio_moneda'],
  })
  tipo: 'ingreso' | 'egreso' | 'ajuste_subcuenta' | 'recurrente' | 'cambio_moneda';

  @Prop({ required: true })
  descripcion: string;

  @Prop()
  motivo?: string;

  @Prop({ required: true })
  fecha: Date;

  @Prop()
  subcuentaId?: string;

  @Prop()
  conceptoId?: string;

  @Prop({ type: Object, default: null })
  metadata?: Record<string, any>;
}

export const CuentaHistorialSchema = SchemaFactory.createForClass(CuentaHistorial);
