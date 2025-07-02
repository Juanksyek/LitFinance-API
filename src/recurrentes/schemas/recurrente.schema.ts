import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RecurrenteDocument = Recurrente & Document;

@Schema({ timestamps: true })
export class Recurrente {
  @Prop({ required: true, unique: true })
  recurrenteId: string;

  @Prop({ required: true })
  nombre: string;

  @Prop({
    type: {
      plataformaId: { type: String, required: true },
      nombre: { type: String, required: true },
      color: { type: String, required: true },
      categoria: { type: String, required: true },
    },
    required: true,
  })
  plataforma: {
    plataformaId: string;
    nombre: string;
    color: string;
    categoria: string;
  };

  // NUEVOS CAMPOS DE FRECUENCIA
  @Prop({ required: true, enum: ['dia_semana', 'dia_mes', 'dia_anio'] })
  frecuenciaTipo: 'dia_semana' | 'dia_mes' | 'dia_anio';

  @Prop({ required: true })
  frecuenciaValor: string;

  @Prop({ required: true })
  moneda: string;

  @Prop({ required: true })
  monto: number;

  @Prop({ required: true })
  afectaCuentaPrincipal: boolean;

  @Prop()
  cuentaId?: string;

  @Prop()
  subcuentaId?: string;

  @Prop({ required: true })
  afectaSubcuenta: boolean;

  @Prop({ required: true })
  proximaEjecucion: Date;

  @Prop({ required: true })
  userId: string;

  @Prop({ type: [Number], default: [] })
  recordatorios: number[];
}

export const RecurrenteSchema = SchemaFactory.createForClass(Recurrente);
