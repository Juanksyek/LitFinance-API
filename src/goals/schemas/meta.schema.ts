import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MetaDocument = Meta & Document;

export const META_ESTADOS = ['activa', 'pausada', 'archivada', 'completada'] as const;
export type MetaEstado = (typeof META_ESTADOS)[number];

@Schema({ timestamps: true })
export class Meta {
  @Prop({ type: String, required: true, index: true })
  userId: string;

  @Prop({ type: String, required: true, unique: true })
  metaId: string;

  // Invariante: toda meta está ligada a una subcuenta real
  @Prop({ type: String, required: true, index: true })
  subcuentaId: string;

  @Prop({ type: String, required: true })
  nombre: string;

  @Prop({ type: Number, required: true })
  objetivo: number;

  @Prop({ type: String, required: true })
  moneda: string;

  @Prop({ type: Date, default: undefined })
  fechaObjetivo?: Date;

  @Prop({ type: Number, default: 0 })
  prioridad?: number;

  @Prop({ type: String, required: true, default: 'activa', index: true, enum: META_ESTADOS })
  estado: MetaEstado;

  @Prop({ type: String, default: undefined })
  color?: string;

  @Prop({ type: String, default: undefined })
  icono?: string;
}

export const MetaSchema = SchemaFactory.createForClass(Meta);

// Índices recomendados
MetaSchema.index({ userId: 1, estado: 1, updatedAt: -1 });

// (Opcional) si consultas por subcuenta seguido
MetaSchema.index({ userId: 1, subcuentaId: 1, updatedAt: -1 });
