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

  @Prop({ required: false, enum: ['dia_semana', 'dia_mes', 'fecha_anual', 'fecha_fija'] })
  frecuenciaTipo?: 'dia_semana' | 'dia_mes' | 'fecha_anual' | 'fecha_fija';

  @Prop({ required: true })
  frecuenciaValor: string;

  @Prop({ required: true })
  moneda: string;

  @Prop({ required: true })
  monto: number;

  // Campos de conversión (se calculan al ejecutar, no al crear)
  // Almacenan la última conversión realizada
  @Prop()
  montoConvertido?: number; // Último monto convertido a monedaPrincipal

  @Prop()
  tasaConversion?: number; // Tasa de conversión de la última ejecución

  @Prop()
  fechaConversion?: Date; // Fecha de la última conversión

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

  @Prop({ default: false })
  pausado: boolean;

  @Prop({ default: 'activo', enum: ['activo', 'ejecutando', 'error', 'pausado', 'completado'] })
  estado: string;

  @Prop()
  ultimaEjecucion?: Date;

  @Prop()
  mensajeError?: string;

  // ===========================
  // NUEVOS CAMPOS: Planes de Pago (Plazo Fijo)
  // ===========================

  @Prop({ 
    required: true, 
    enum: ['indefinido', 'plazo_fijo'], 
    default: 'indefinido' 
  })
  tipoRecurrente: 'indefinido' | 'plazo_fijo';

  // Campos SOLO para plazo_fijo
  @Prop({ required: false })
  totalPagos?: number; // Requerido si tipoRecurrente === 'plazo_fijo'

  @Prop({ default: 0 })
  pagosRealizados: number; // Inicia en 0, se incrementa con cada ejecución

  @Prop()
  fechaInicio?: Date; // Opcional (default: fecha de creación)

  @Prop()
  fechaFin?: Date; // Opcional (calculable basado en totalPagos y frecuencia)
}

export const RecurrenteSchema = SchemaFactory.createForClass(Recurrente);