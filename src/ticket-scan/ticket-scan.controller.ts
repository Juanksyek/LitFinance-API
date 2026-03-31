import {
  Controller, Post, Get, Delete, Body, Param, Query, Req,
  UseGuards, HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TicketScanService } from './ticket-scan.service';
import { EvaluationService } from './ocr/evaluation.service';
import {
  CreateTicketFromOcrDto,
  CreateTicketManualDto,
  ConfirmTicketDto,
  TicketFiltersDto,
  LiquidateTicketDto,
} from './dto/ticket-scan.dto';

@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketScanController {
  constructor(
    private readonly ticketScanService: TicketScanService,
    private readonly evaluationService: EvaluationService,
  ) {}

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
   * Evaluación: métricas de precisión OCR por campo (usa tickets corregidos como ground truth).
   */
  @Get('evaluation')
  async evaluation(
    @Req() req,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.evaluationService.getAccuracyReport(req.user.id, desde, hasta);
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

  /**
   * Liquidar (pagar) un ticket seleccionando cuenta o subcuenta.
   * El frontend debe enviar opcionalmente `subCuentaId` o `cuentaId`.
   */
  @Post(':ticketId/liquidar')
  @HttpCode(200)
  async liquidarTicket(
    @Req() req,
    @Param('ticketId') ticketId: string,
    @Body() dto,
  ) {
    return this.ticketScanService.liquidar(req.user.id, ticketId, dto);
  }

  /**
   * Eliminar ticket permanentemente.
   * Si el ticket tiene una transacción asociada, esta NO se elimina automáticamente.
   */
  @Delete(':ticketId')
  @HttpCode(200)
  async deleteTicket(
    @Req() req,
    @Param('ticketId') ticketId: string,
  ) {
    return this.ticketScanService.remove(req.user.id, ticketId);
  }
}
