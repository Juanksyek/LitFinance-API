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

  // Legacy compatibility: metas antiguas estaban ligadas a una subcuenta.
  // En el nuevo modelo, la meta es independiente y maneja su propio saldo.
  @Prop({ type: String, default: undefined, index: true })
  subcuentaId?: string;

  // Saldo actual de la meta (modelo independiente)
  @Prop({ type: Number, required: true, default: 0 })
  saldo: number;

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

  // Completion flow (cuando se alcanza el objetivo)
  @Prop({ type: Date, default: undefined })
  completedAt?: Date;

  // True cuando la meta se completa y aún falta decidir qué hacer.
  // Nota: para metas antiguas ya completadas, este campo puede estar undefined.
  @Prop({ type: Boolean, default: false, index: true })
  completionPendingDecision?: boolean;

  // Decisión final (auditable). Se mantiene como objeto flexible para permitir evolución sin migraciones.
  @Prop({ type: Object, default: undefined })
  completionDecision?: {
    moneyAction: 'keep' | 'transfer_to_main' | 'mark_used';
    metaAction: 'none' | 'archive' | 'reset' | 'duplicate';
    decidedAt: Date;
    motivo?: string;
    movedAmount?: number;
    txId?: string;
    duplicatedMetaId?: string;
  };
}

export const MetaSchema = SchemaFactory.createForClass(Meta);

// Índices recomendados
MetaSchema.index({ userId: 1, estado: 1, updatedAt: -1 });

// (Opcional) si consultas por subcuenta seguido
MetaSchema.index({ userId: 1, subcuentaId: 1, updatedAt: -1 });
