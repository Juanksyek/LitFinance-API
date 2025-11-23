import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SupportTicketDocument = SupportTicket & Document;

export enum TicketStatus {
  ABIERTO = 'abierto',
  EN_PROGRESO = 'en_progreso',
  RESUELTO = 'resuelto',
  CERRADO = 'cerrado'
}

// Interfaz para los mensajes dentro del ticket
export interface TicketMessage {
  id: string;
  mensaje: string;
  esStaff: boolean; // true si es del staff de soporte, false si es del usuario
  creadoPor: string; // userId o identificador del staff
  createdAt: Date;
}

@Schema({
  timestamps: true,
  collection: 'support_tickets'
})
export class SupportTicket {
  @Prop({ required: true, unique: true })
  ticketId: string; // ID aleatorio generado

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, maxlength: 200, trim: true })
  titulo: string;

  @Prop({ required: true, maxlength: 2000, trim: true })
  descripcion: string;

  @Prop({ 
    type: String, 
    enum: Object.values(TicketStatus), 
    default: TicketStatus.ABIERTO 
  })
  estado: TicketStatus;

  @Prop({ type: Array, default: [] })
  mensajes: TicketMessage[];

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;

  @Prop()
  resolvidoEn?: Date;

  @Prop()
  cerradoEn?: Date;
}

export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);

// Índices para optimización
SupportTicketSchema.index({ ticketId: 1 }, { unique: true });
SupportTicketSchema.index({ userId: 1, createdAt: -1 });
SupportTicketSchema.index({ estado: 1, createdAt: -1 });
