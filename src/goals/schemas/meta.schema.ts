import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MetaDocument = Meta & Document;

export type MetaEstado = 'activa' | 'pausada' | 'archivada' | 'completada';

@Schema({ timestamps: true })
export class Meta {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, unique: true })
  metaId: string;

  // Invariante: toda meta está ligada a una subcuenta real
  @Prop({ required: true, index: true })
  subcuentaId: string;

  @Prop({ required: true })
  nombre: string;

  @Prop({ required: true })
  objetivo: number;

  @Prop({ required: true })
  moneda: string;

  @Prop({ default: null })
  fechaObjetivo?: Date | null;

  @Prop({ default: 0 })
  prioridad?: number;

  @Prop({ required: true, default: 'activa', index: true })
  estado: MetaEstado;

  @Prop({ default: null })
  color?: string | null;

  @Prop({ default: null })
  icono?: string | null;
}

export const MetaSchema = SchemaFactory.createForClass(Meta);

// Índices recomendados
MetaSchema.index({ userId: 1, estado: 1, updatedAt: -1 });
