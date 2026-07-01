import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreditCardService } from './credit-card.service';
import {
  CreateCreditCardDto,
  UpdateCreditCardDto,
  AddMovimientoDto,
  MovimientosQueryDto,
} from './dto/credit-card.dto';
import { CreditCardListQueryDto } from './dto/credit-card-list-query.dto';
import { Request } from 'express';

@UseGuards(JwtAuthGuard)
@Controller('credit-cards')
export class CreditCardController {
  constructor(private readonly creditCardService: CreditCardService) {}

  // ─── Resumen global (para dashboard — sin :id para no colisionar) ────────

  /**
   * GET /credit-cards/resumen
   * Devuelve totales + lista ligera de todas las tarjetas del usuario.
   * Útil para el widget del dashboard.
   */
  @Get('resumen')
  getResumen(@Req() req: Request) {
    const userId = (req as any).user.id;
    return this.creditCardService.obtenerResumenDashboard(userId);
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  /**
   * GET /credit-cards
   * Lista todas las tarjetas del usuario con salud financiera calculada.
   */
  @Get()
  listar(@Req() req: Request, @Query() query: CreditCardListQueryDto) {
    const userId = (req as any).user.id;
    return this.creditCardService.listar(
      userId,
      Number(query.page ?? 1),
      Number(query.limit ?? 20),
      query.search ?? '',
      query.estado,
    );
  }

  /**
   * POST /credit-cards
   * Crea una nueva tarjeta de crédito.
   * Requiere plan: 1 tarjeta gratis, ilimitadas en premium.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(@Req() req: Request, @Body() dto: CreateCreditCardDto) {
    const userId = (req as any).user.id;
    return this.creditCardService.crear(dto, userId);
  }

  /**
   * GET /credit-cards/:id
   * Detalle completo de una tarjeta + salud financiera + movimientos recientes.
   */
  @Get(':id')
  detalle(@Req() req: Request, @Param('id') id: string) {
    const userId = (req as any).user.id;
    return this.creditCardService.obtenerDetalle(id, userId);
  }

  /**
   * PATCH /credit-cards/:id
   * Actualiza nombre, límite, fechas, recordatorios, etc.
   */
  @Patch(':id')
  actualizar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateCreditCardDto,
  ) {
    const userId = (req as any).user.id;
    return this.creditCardService.actualizar(id, userId, dto);
  }

  /**
   * PUT /credit-cards/:id
   * Alias completo para actualización (útil para el frontend que envía el recurso completo).
   * Funciona igual que PATCH y acepta los mismos campos del DTO `UpdateCreditCardDto`.
   */
  @Put(':id')
  reemplazar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateCreditCardDto,
  ) {
    const userId = (req as any).user.id;
    return this.creditCardService.actualizar(id, userId, dto);
  }

  /**
   * DELETE /credit-cards/:id
   * Elimina la tarjeta permanentemente.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  eliminar(@Req() req: Request, @Param('id') id: string) {
    const userId = (req as any).user.id;
    return this.creditCardService.eliminar(id, userId);
  }

  // ─── Movimientos ─────────────────────────────────────────────────────────

  /**
   * POST /credit-cards/:id/movimientos
   * Registra un movimiento: compra, pago, crédito o ajuste.
   * Actualiza el saldo usado y la salud financiera del card.
   */
  @Post(':id/movimientos')
  @HttpCode(HttpStatus.CREATED)
  agregarMovimiento(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AddMovimientoDto,
  ) {
    const userId = (req as any).user.id;
    return this.creditCardService.agregarMovimiento(id, userId, dto);
  }

  /**
   * GET /credit-cards/:id/movimientos
   * Lista los movimientos embebidos del card (paginado).
   * Parámetros: page, limit, desde (ISO), hasta (ISO)
   */
  @Get(':id/movimientos')
  obtenerMovimientos(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() query: MovimientosQueryDto,
  ) {
    const userId = (req as any).user.id;
    return this.creditCardService.obtenerMovimientos(id, userId, query);
  }

  // ─── Salud financiera ────────────────────────────────────────────────────

  /**
   * GET /credit-cards/:id/salud
   * Retorna el reporte completo de salud: utilización, score, alertas, pago mínimo.
   */
  @Get(':id/salud')
  obtenerSalud(@Req() req: Request, @Param('id') id: string) {
    const userId = (req as any).user.id;
    return this.creditCardService.obtenerSalud(id, userId);
  }
}
