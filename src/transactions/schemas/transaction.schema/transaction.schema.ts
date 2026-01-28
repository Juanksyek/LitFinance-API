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

  // Fecha efectiva del movimiento (para registrar gastos/ingresos atrasados).
  // NOTA: createdAt/updatedAt (timestamps) sigue representando el registro en BD.
  @Prop()
  fecha?: Date;

  // Fecha real de registro (auditoría). Útil cuando fecha (efectiva) != createdAt.
  @Prop()
  registradoEn?: Date;

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
  monedaConvertida?: string; // Moneda destino usada para montoConvertido

  @Prop()
  tasaConversion?: number; // Tasa de conversión usada

  @Prop()
  fechaConversion?: Date; // Fecha de la conversión

  // Conversión para ajustes en subcuenta (cuando moneda de transacción != moneda de subcuenta)
  @Prop()
  montoSubcuentaConvertido?: number;

  @Prop()
  monedaSubcuentaConvertida?: string;

  @Prop()
  tasaConversionSubcuenta?: number;

  @Prop()
  fechaConversionSubcuenta?: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);