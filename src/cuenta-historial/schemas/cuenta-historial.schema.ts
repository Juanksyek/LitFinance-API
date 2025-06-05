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
    enum: ['ingreso', 'egreso', 'ajuste_subcuenta', 'recurrente'],
  })
  tipo: 'ingreso' | 'egreso' | 'ajuste_subcuenta' | 'recurrente';

  @Prop({ required: true })
  descripcion: string;

  @Prop({ required: true })
  fecha: Date;

  @Prop()
  subcuentaId?: string;

  @Prop()
  conceptoId?: string;
}

export const CuentaHistorialSchema = SchemaFactory.createForClass(CuentaHistorial);
