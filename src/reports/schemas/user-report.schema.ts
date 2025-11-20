import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserReportDocument = UserReport & Document;

export enum ReportStatus {
  ABIERTO = 'abierto',
  EN_PROGRESO = 'en_progreso',
  PAUSADO = 'pausado',
  RESUELTO = 'resuelto',
  RECHAZADO = 'rechazado',
  CERRADO = 'cerrado'
}

export enum ReportPriority {
  BAJA = 'baja',
  MEDIA = 'media',
  ALTA = 'alta',
  CRITICA = 'critica'
}

export enum ReportCategory {
  FUNCIONALIDAD = 'funcionalidad',
  ERROR = 'error',
  MEJORA = 'mejora',
  SEGURIDAD = 'seguridad',
  RENDIMIENTO = 'rendimiento',
  USABILIDAD = 'usabilidad',
  OTRO = 'otro'
}

@Schema({
  timestamps: true,
  collection: 'user_reports'
})
export class UserReport {
  @Prop({ required: true, unique: true })
  ticketId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, maxlength: 200, trim: true })
  titulo: string;

  @Prop({ required: true, maxlength: 2000, trim: true })
  descripcion: string;

  @Prop({ 
    type: String, 
    enum: Object.values(ReportCategory), 
    default: ReportCategory.FUNCIONALIDAD 
  })
  categoria: ReportCategory;

  @Prop({ 
    type: String, 
    enum: Object.values(ReportStatus), 
    default: ReportStatus.ABIERTO 
  })
  estado: ReportStatus;

  @Prop({ 
    type: String, 
    enum: Object.values(ReportPriority), 
    default: ReportPriority.MEDIA 
  })
  prioridad: ReportPriority;

  @Prop({ maxlength: 1000, trim: true })
  respuestaAdmin?: string;

  @Prop()
  asignadoA?: string;

  @Prop()
  resolvidoEn?: Date;

  @Prop()
  cerradoEn?: Date;

  @Prop({ default: 0 })
  tiempoRespuestaMinutos: number;

  @Prop({ type: Object })
  metadataUsuario: {
    email: string;
    nombre: string;
    monedaPreferencia: string;
    fechaRegistro: Date;
    ultimaActividad: Date;
    version: string;
    dispositivo?: string;
  };

  // Historial de cambios de estado
  @Prop([{
    estado: { type: String, enum: Object.values(ReportStatus) },
    fechaCambio: { type: Date, default: Date.now },
    cambiadoPor: String,
    comentario: String
  }])
  historialEstados: Array<{
    estado: ReportStatus;
    fechaCambio: Date;
    cambiadoPor: string;
    comentario?: string;
  }>;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const UserReportSchema = SchemaFactory.createForClass(UserReport);

// Índices para optimización
UserReportSchema.index({ userId: 1, createdAt: -1 });
UserReportSchema.index({ ticketId: 1 }, { unique: true });
UserReportSchema.index({ estado: 1, prioridad: -1 });
UserReportSchema.index({ categoria: 1, estado: 1 });
UserReportSchema.index({ asignadoA: 1, estado: 1 });