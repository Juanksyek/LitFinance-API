import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { SupportTicketService } from '../services/support-ticket.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  CreateTicketDto,
  AddMessageDto,
  UpdateTicketStatusDto,
  UpdateTicketDto,
  FilterTicketsDto,
} from '../dto/support-ticket.dto';

@Controller('support-tickets')
@UseGuards(JwtAuthGuard)
export class SupportTicketController {
  constructor(private readonly supportTicketService: SupportTicketService) {}

  /**
   * POST /support-tickets
   * Crear un nuevo ticket de soporte
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createTicket(@Body() createTicketDto: CreateTicketDto, @Req() req) {
    if (!req.user || !(req.user._id || req.user.id)) {
      throw new UnauthorizedException('Usuario no autenticado');
    }
    const userId = req.user._id || req.user.id;
    return await this.supportTicketService.createTicket(createTicketDto, userId);
  }

  /**
   * GET /support-tickets
   * Listar tickets (usuarios ven solo los suyos, staff ve todos)
   */
  @Get()
  async listTickets(@Query() filters: FilterTicketsDto, @Req() req) {
    if (!req.user || !(req.user._id || req.user.id)) {
      throw new UnauthorizedException('Usuario no autenticado');
    }
    const userId = req.user._id || req.user.id;
    const isStaff = req.user.rol === 'admin' || req.user.rol === 'staff';

    if (isStaff) {
      // Staff puede ver todos los tickets con filtros opcionales
      return await this.supportTicketService.findAll(filters);
    } else {
      // Usuarios normales solo ven sus propios tickets
      return await this.supportTicketService.findByUserId(userId);
    }
  }

  /**
   * GET /support-tickets/statistics
   * Obtener estadísticas de tickets (solo staff)
   */
  @Get('statistics')
  @UseGuards(RolesGuard)
  @Roles('admin', 'staff')
  async getStatistics() {
    return await this.supportTicketService.getStatistics();
  }

  /**
   * GET /support-tickets/:ticketId
   * Obtener un ticket específico por ID
   */
  @Get(':ticketId')
  async getTicket(@Param('ticketId') ticketId: string, @Req() req) {
    if (!req.user || !(req.user._id || req.user.id)) {
      throw new UnauthorizedException('Usuario no autenticado');
    }
    const userId = req.user._id || req.user.id;
    const isStaff = req.user.rol === 'admin' || req.user.rol === 'staff';

    if (isStaff) {
      // Staff puede ver cualquier ticket
      return await this.supportTicketService.findOne(ticketId);
    } else {
      // Usuarios solo pueden ver sus propios tickets
      return await this.supportTicketService.verifyOwnership(ticketId, userId);
    }
  }

  /**
   * POST /support-tickets/:ticketId/messages
   * Agregar un mensaje/respuesta al ticket
   */
  @Post(':ticketId/messages')
  @HttpCode(HttpStatus.OK)
  async addMessage(
    @Param('ticketId') ticketId: string,
    @Body() addMessageDto: AddMessageDto,
    @Req() req,
  ) {
    if (!req.user || !(req.user._id || req.user.id)) {
      throw new UnauthorizedException('Usuario no autenticado');
    }
    const userId = req.user._id || req.user.id;
    const isStaff = req.user.rol === 'admin' || req.user.rol === 'staff';

    return await this.supportTicketService.addMessage(
      ticketId,
      addMessageDto,
      userId,
      isStaff,
    );
  }

  /**
   * PUT /support-tickets/:ticketId/status
   * Actualizar el estado del ticket (solo staff)
   */
  @Put(':ticketId/status')
  @UseGuards(RolesGuard)
  @Roles('admin', 'staff')
  async updateStatus(
    @Param('ticketId') ticketId: string,
    @Body() updateStatusDto: UpdateTicketStatusDto,
  ) {
    return await this.supportTicketService.updateStatus(ticketId, updateStatusDto);
  }

  /**
   * PUT /support-tickets/:ticketId
   * Actualizar información del ticket (título o descripción)
   */
  @Put(':ticketId')
  async updateTicket(
    @Param('ticketId') ticketId: string,
    @Body() updateTicketDto: UpdateTicketDto,
    @Req() req,
  ) {
    if (!req.user || !(req.user._id || req.user.id)) {
      throw new UnauthorizedException('Usuario no autenticado');
    }
    const userId = req.user._id || req.user.id;
    const isStaff = req.user.rol === 'admin' || req.user.rol === 'staff';

    return await this.supportTicketService.updateTicket(
      ticketId,
      updateTicketDto,
      userId,
      isStaff,
    );
  }

  /**
   * DELETE /support-tickets/:ticketId
   * Eliminar un ticket
   */
  @Delete(':ticketId')
  @HttpCode(HttpStatus.OK)
  async deleteTicket(@Param('ticketId') ticketId: string, @Req() req) {
    if (!req.user || !(req.user._id || req.user.id)) {
      throw new UnauthorizedException('Usuario no autenticado');
    }
    const userId = req.user._id || req.user.id;
    const isStaff = req.user.rol === 'admin' || req.user.rol === 'staff';

    return await this.supportTicketService.deleteTicket(ticketId, userId, isStaff);
  }
}
