import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WebReportDocument = WebReport & Document;

export enum WebReportStatus {
  PENDIENTE = 'pendiente',
  REVISADO = 'revisado',
  RESPONDIDO = 'respondido',
  CERRADO = 'cerrado',
  SPAM = 'spam'
}

@Schema({
  timestamps: true,
  collection: 'web_reports'
})
export class WebReport {
  @Prop({ required: true, unique: true })
  ticketId: string;

  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, maxlength: 150, trim: true })
  asunto: string;

  @Prop({ required: true, maxlength: 1500, trim: true })
  descripcion: string;

  @Prop({ 
    type: String, 
    enum: Object.values(WebReportStatus), 
    default: WebReportStatus.PENDIENTE 
  })
  estado: WebReportStatus;

  @Prop({ maxlength: 1000, trim: true })
  respuestaAdmin?: string;

  @Prop()
  respondidoEn?: Date;

  @Prop()
  cerradoEn?: Date;

  @Prop({ required: true })
  ipAddress: string;

  @Prop()
  userAgent?: string;

  @Prop()
  referer?: string;

  @Prop({ default: false })
  esSospechoso: boolean;

  @Prop({ default: 0 })
  puntuacionRiesgo: number; // 0-100

  @Prop({ type: Object })
  geolocalizacion?: {
    pais?: string;
    ciudad?: string;
    timezone?: string;
  };

  // Control de rate limiting
  @Prop({ default: 1 })
  intentosDesdeIP: number;

  @Prop()
  ultimoIntentoIP?: Date;

  // Validaciones de contenido
  @Prop({ type: Object })
  validacionesContenido: {
    contieneLinksExternos: boolean;
    contieneEmojisSospechosos: boolean;
    longitudTexto: number;
    palabrasProhibidas: string[];
    puntuacionSpam: number; // 0-100
  };

  // Historial de acciones
  @Prop([{
    accion: String,
    fecha: { type: Date, default: Date.now },
    realizadaPor: String,
    detalles: String
  }])
  historialAcciones: Array<{
    accion: string;
    fecha: Date;
    realizadaPor: string;
    detalles?: string;
  }>;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })  
  updatedAt: Date;
}

export const WebReportSchema = SchemaFactory.createForClass(WebReport);

// Índices para seguridad y optimización
WebReportSchema.index({ ipAddress: 1, createdAt: -1 });
WebReportSchema.index({ email: 1, createdAt: -1 });
WebReportSchema.index({ ticketId: 1 }, { unique: true });
WebReportSchema.index({ estado: 1, createdAt: -1 });
WebReportSchema.index({ esSospechoso: 1, puntuacionRiesgo: -1 });
WebReportSchema.index({ 'validacionesContenido.puntuacionSpam': -1 });

// TTL para limpiar reportes antiguos de spam (opcional)
WebReportSchema.index(
  { createdAt: 1 }, 
  { 
    expireAfterSeconds: 365 * 24 * 60 * 60, // 1 año
    partialFilterExpression: { estado: WebReportStatus.SPAM }
  }
);