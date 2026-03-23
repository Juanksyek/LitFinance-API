import {
  Controller, Post, Get, Body, Param, Query, Req,
  UseGuards, HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TicketScanService } from './ticket-scan.service';
import {
  CreateTicketFromOcrDto,
  CreateTicketManualDto,
  ConfirmTicketDto,
  TicketFiltersDto,
} from './dto/ticket-scan.dto';

@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketScanController {
  constructor(private readonly ticketScanService: TicketScanService) {}

  /**
   * Escanear ticket: recibe imagen base64 + texto OCR opcional.
   * El frontend debe hacer el OCR con ML Kit o Vision y enviar el texto.
   */
  @Post('scan')
  async scanTicket(
    @Req() req,
    @Body() dto: CreateTicketFromOcrDto,
  ) {
    return this.ticketScanService.createFromOcr(req.user.id, dto, dto.ocrTexto);
  }

  /**
   * Crear ticket manualmente sin escaneo.
   */
  @Post('manual')
  async createManual(
    @Req() req,
    @Body() dto: CreateTicketManualDto,
  ) {
    return this.ticketScanService.createManual(req.user.id, dto);
  }

  /**
   * Confirmar ticket y aplicar cargo a la cuenta.
   * Opcionalmente editar datos antes de confirmar.
   */
  @Post(':ticketId/confirm')
  @HttpCode(200)
  async confirmTicket(
    @Req() req,
    @Param('ticketId') ticketId: string,
    @Body() dto: ConfirmTicketDto,
  ) {
    return this.ticketScanService.confirmAndCharge(req.user.id, ticketId, dto);
  }

  /**
   * Listar tickets del usuario con filtros opcionales.
   */
  @Get()
  async listTickets(
    @Req() req,
    @Query() filters: TicketFiltersDto,
  ) {
    return this.ticketScanService.list(req.user.id, filters);
  }

  /**
   * Analytics: resumen de gastos por tienda y categoría.
   */
  @Get('analytics')
  async ticketAnalytics(
    @Req() req,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.ticketScanService.getTicketAnalytics(req.user.id, desde, hasta);
  }

  /**
   * Detalle de un ticket (sin imagen por defecto).
   */
  @Get(':ticketId')
  async getTicket(
    @Req() req,
    @Param('ticketId') ticketId: string,
    @Query('includeImage') includeImage?: string,
  ) {
    return this.ticketScanService.getById(req.user.id, ticketId, includeImage === 'true');
  }

  /**
   * Obtener solo la imagen del ticket (útil para mostrar preview).
   */
  @Get(':ticketId/image')
  async getTicketImage(
    @Req() req,
    @Param('ticketId') ticketId: string,
  ) {
    return this.ticketScanService.getImage(req.user.id, ticketId);
  }

  /**
   * Cancelar ticket.
   */
  @Post(':ticketId/cancel')
  @HttpCode(200)
  async cancelTicket(
    @Req() req,
    @Param('ticketId') ticketId: string,
  ) {
    return this.ticketScanService.cancel(req.user.id, ticketId);
  }
}
