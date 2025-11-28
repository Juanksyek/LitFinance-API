import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TransactionDocument = Transaction & Document;

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ required: true })
  transaccionId: string;

  @Prop({ required: true })
  tipo: 'ingreso' | 'egreso';

  // Monto original en la moneda en que se realizó la transacción
  @Prop({ required: true })
  monto: number;

  // Código ISO de la moneda de la transacción
  @Prop({ required: true, default: 'MXN' })
  moneda: string;

  @Prop({ required: true })
  concepto: string;

  @Prop()
  motivo?: string;

  @Prop({ required: true })
  userId: string;

  @Prop()
  cuentaId?: string;

  @Prop()
  subCuentaId?: string;

  @Prop({ required: true, default: false })
  afectaCuenta: boolean;

  // Campos de conversión (calculados cuando moneda != monedaPrincipal del usuario)
  @Prop()
  montoConvertido?: number; // Monto en monedaPrincipal del usuario

  @Prop()
  tasaConversion?: number; // Tasa de conversión usada

  @Prop()
  fechaConversion?: Date; // Fecha de la conversión
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);