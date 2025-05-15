import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TransactionDocument = Transaction & Document;

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ required: true })
  transaccionId: string;

  @Prop({ required: true })
  tipo: 'ingreso' | 'egreso';

  @Prop({ required: true })
  monto: number;

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
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);