import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PlanConfigDocument = PlanConfig & Document;

@Schema({ timestamps: true })
export class PlanConfig {
  @Prop({ required: true, unique: true, default: 'free_plan' })
  planType: string; // 'free_plan', 'premium_plan', etc.

  @Prop({ required: true, default: 10 })
  transaccionesPorDia: number;

  @Prop({ required: true, default: 30 })
  historicoLimitadoDias: number;

  @Prop({ required: true, default: 3 })
  recurrentesPorUsuario: number;

  @Prop({ required: true, default: 2 })
  subcuentasPorUsuario: number;

  @Prop({ required: true, default: false })
  graficasAvanzadas: boolean;

  @Prop({ required: true, default: false })
  reportesExportables: boolean;

  @Prop({ default: true })
  activo: boolean;
}

export const PlanConfigSchema = SchemaFactory.createForClass(PlanConfig);
