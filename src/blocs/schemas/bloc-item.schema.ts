import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BlocItemDocument = BlocItem & Document;

@Schema({ timestamps: true })
export class BlocItem {
  @Prop({ required: true, unique: true })
  itemId: string;

  @Prop({ required: true })
  blocId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  categoria: string;

  @Prop({ required: true })
  titulo: string;

  @Prop()
  descripcion?: string;

  @Prop({ required: true })
  moneda: string; // ISO (MXN, USD, ...)

  @Prop({ required: true, enum: ['monto', 'articulo'], default: 'monto' })
  modo: 'monto' | 'articulo';

  // modo: monto
  @Prop()
  monto?: number;

  // modo: articulo
  @Prop()
  cantidad?: number;

  @Prop()
  precioUnitario?: number;

  @Prop({ required: true, enum: ['pendiente', 'parcial', 'pagado', 'archivado'], default: 'pendiente' })
  estado: 'pendiente' | 'parcial' | 'pagado' | 'archivado';

  // En la misma moneda del item
  @Prop({ default: 0 })
  pagadoAcumulado: number;

  @Prop()
  vencimiento?: Date;

  @Prop({ type: [String], default: [] })
  adjuntos?: string[];

  @Prop()
  lastLiquidationId?: string;

  @Prop()
  lastTransactionId?: string;
}

export const BlocItemSchema = SchemaFactory.createForClass(BlocItem);
BlocItemSchema.index({ userId: 1, blocId: 1, createdAt: -1 });
BlocItemSchema.index({ userId: 1, itemId: 1 }, { unique: true });
