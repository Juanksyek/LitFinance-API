import { 
  Injectable, 
  NotFoundException, 
  BadRequestException,
  ForbiddenException 
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { 
  SupportTicket, 
  SupportTicketDocument, 
  TicketStatus,
  TicketMessage 
} from '../schemas/support-ticket.schema';
import { 
  CreateTicketDto, 
  AddMessageDto, 
  UpdateTicketStatusDto,
  UpdateTicketDto,
  FilterTicketsDto 
} from '../dto/support-ticket.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class SupportTicketService {
  constructor(
    @InjectModel(SupportTicket.name)
    private supportTicketModel: Model<SupportTicketDocument>,
  ) {}

  /**
   * Genera un ID único aleatorio para el ticket
   */
  private generateTicketId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = randomBytes(6).toString('hex').toUpperCase();
    return `TKT-${timestamp}-${randomPart}`;
  }

  /**
   * Genera un ID único para un mensaje
   */
  private generateMessageId(): string {
    return randomBytes(8).toString('hex');
  }

  /**
   * Crear un nuevo ticket de soporte
   */
  async createTicket(
    createTicketDto: CreateTicketDto, 
    userId: string
  ): Promise<SupportTicket> {
    const ticketId = this.generateTicketId();

    const newTicket = new this.supportTicketModel({
      ticketId,
      userId,
      titulo: createTicketDto.titulo,
      descripcion: createTicketDto.descripcion,
      estado: TicketStatus.ABIERTO,
      mensajes: [],
    });

    return await newTicket.save();
  }

  /**
   * Listar todos los tickets (con filtros opcionales)
   */
  async findAll(filters?: FilterTicketsDto): Promise<SupportTicket[]> {
    const query: any = {};

    if (filters?.estado) {
      query.estado = filters.estado;
    }

    if (filters?.userId) {
      query.userId = filters.userId;
    }

    return await this.supportTicketModel
      .find(query)
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Listar tickets de un usuario específico
   */
  async findByUserId(userId: string): Promise<SupportTicket[]> {
    return await this.supportTicketModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Obtener un ticket por su ID
   * Ahora cualquier usuario puede consultar el ticket.
   */
  async findOne(ticketId: string): Promise<SupportTicket> {
    const ticket = await this.supportTicketModel
      .findOne({ ticketId })
      .exec();

    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} no encontrado`);
    }

    return ticket;
  }

  /**
   * Verificar que el usuario sea dueño del ticket
   * (Este método puede seguir existiendo para acciones restringidas, pero no se usa para consulta ni para comentar)
   */
  async verifyOwnership(ticketId: string, userId: string): Promise<SupportTicket> {
    const ticket = await this.findOne(ticketId);
    
    if (ticket.userId !== userId) {
      throw new ForbiddenException('No tienes permiso para acceder a este ticket');
    }

    return ticket;
  }

  /**
   * Agregar un mensaje/respuesta al ticket
   * Permitir que cualquier usuario registrado agregue mensajes/comentarios,
   * excepto si el ticket está cerrado.
   */
  async addMessage(
    ticketId: string,
    addMessageDto: AddMessageDto,
    userId: string,
    isStaff: boolean = false
  ): Promise<SupportTicket> {
    const ticket = await this.supportTicketModel.findOne({ ticketId }).exec();

    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} no encontrado`);
    }

    // Solo debe impedir si el ticket está cerrado
    if (ticket.estado === TicketStatus.CERRADO) {
      throw new BadRequestException('No se pueden agregar mensajes a un ticket cerrado');
    }

    const newMessage: TicketMessage = {
      id: this.generateMessageId(),
      mensaje: addMessageDto.mensaje,
      esStaff: isStaff,
      creadoPor: userId,
      createdAt: new Date(),
    };

    ticket.mensajes.push(newMessage);

    if (!isStaff && ticket.estado === TicketStatus.RESUELTO) {
      ticket.estado = TicketStatus.ABIERTO;
    }

    ticket.updatedAt = new Date();
    return await ticket.save();
  }

  /**
   * Actualizar el estado del ticket (solo staff)
   */
  async updateStatus(
    ticketId: string,
    updateStatusDto: UpdateTicketStatusDto
  ): Promise<SupportTicket> {
    const ticket = await this.supportTicketModel.findOne({ ticketId }).exec();

    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} no encontrado`);
    }

    ticket.estado = updateStatusDto.estado;
    ticket.updatedAt = new Date();

    // Registrar fecha de resolución o cierre
    if (updateStatusDto.estado === TicketStatus.RESUELTO && !ticket.resolvidoEn) {
      ticket.resolvidoEn = new Date();
    }

    if (updateStatusDto.estado === TicketStatus.CERRADO) {
      ticket.cerradoEn = new Date();
    }

    return await ticket.save();
  }

  /**
   * Actualizar información del ticket (título o descripción)
   */
  async updateTicket(
    ticketId: string,
    updateTicketDto: UpdateTicketDto,
    userId: string,
    isStaff: boolean = false
  ): Promise<SupportTicket> {
    const ticket = await this.supportTicketModel.findOne({ ticketId }).exec();

    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} no encontrado`);
    }

    // Solo el dueño o staff pueden editar
    // Compara como string para evitar problemas de tipo
    if (!isStaff && String(ticket.userId) !== String(userId)) {
      throw new ForbiddenException('No tienes permiso para editar este ticket');
    }

    if (updateTicketDto.titulo) {
      ticket.titulo = updateTicketDto.titulo;
    }

    if (updateTicketDto.descripcion) {
      ticket.descripcion = updateTicketDto.descripcion;
    }

    ticket.updatedAt = new Date();
    return await ticket.save();
  }

  /**
   * Eliminar un ticket
   */
  async deleteTicket(
    ticketId: string,
    userId: string,
    isStaff: boolean = false
  ): Promise<{ message: string }> {
    const ticket = await this.findOne(ticketId);

    // Solo el dueño o staff pueden eliminar
    // Compara como string para evitar problemas de tipo
    if (!isStaff && String(ticket.userId) !== String(userId)) {
      throw new ForbiddenException('No tienes permiso para eliminar este ticket');
    }

    await this.supportTicketModel.deleteOne({ ticketId }).exec();
    return { message: `Ticket ${ticketId} eliminado exitosamente` };
  }

  /**
   * Obtener estadísticas de tickets (útil para panel de admin)
   */
  async getStatistics(): Promise<any> {
    const total = await this.supportTicketModel.countDocuments().exec();
    const abiertos = await this.supportTicketModel.countDocuments({ estado: TicketStatus.ABIERTO }).exec();
    const enProgreso = await this.supportTicketModel.countDocuments({ estado: TicketStatus.EN_PROGRESO }).exec();
    const resueltos = await this.supportTicketModel.countDocuments({ estado: TicketStatus.RESUELTO }).exec();
    const cerrados = await this.supportTicketModel.countDocuments({ estado: TicketStatus.CERRADO }).exec();

    return {
      total,
      abiertos,
      enProgreso,
      resueltos,
      cerrados,
    };
  }
}
