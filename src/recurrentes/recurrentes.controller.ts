import { Controller, Get, Req, Post, Body, Param, Put, Delete, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { RecurrentesService } from './recurrentes.service';
import { CrearRecurrenteDto } from './dto/crear-recurrente.dto';
import { EditarRecurrenteDto } from './dto/editar-recurrente.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('recurrentes')
export class RecurrentesController {
  constructor(private readonly recurrentesService: RecurrentesService) {}

  @Post()
  async crear(@Req() req, @Body() dto: CrearRecurrenteDto) {
    const userId = req.user.id;
    return this.recurrentesService.crear(dto, userId);
  }

  @Get()
  async listar(
    @Req() req,
    @Query('page') page = 1,
    @Query('limit') limit = 4,
    @Query('search') search = '',
    @Query('subcuentaId') subcuentaId = '',
  ) {
    return this.recurrentesService.listar(
      req.user.id,
      Number(page),
      Number(limit),
      search,
      subcuentaId || undefined,
    );
  }

  @Get(':recurrenteId')
  async obtener(@Param('recurrenteId') recurrenteId: string) {
    return this.recurrentesService.obtenerPorId(recurrenteId);
  }

  @Put(':recurrenteId')
  async editar(@Param('recurrenteId') recurrenteId: string, @Body() dto: EditarRecurrenteDto) {
    return this.recurrentesService.editar(recurrenteId, dto);
  }

  @Delete(':recurrenteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(@Param('recurrenteId') recurrenteId: string) {
    return this.recurrentesService.eliminar(recurrenteId);
  }

  @Post('/ejecutar/hoy')
  async ejecutarHoy() {
    const cantidad = await this.recurrentesService.ejecutarRecurrentesDelDia();
    return { ejecutados: cantidad };
  }

  @Put(':recurrenteId/pausar')
  async pausar(@Param('recurrenteId') recurrenteId: string, @Req() req) {
    return this.recurrentesService.pausarRecurrente(recurrenteId, req.user.id);
  }

  @Put(':recurrenteId/reanudar')
  async reanudar(@Param('recurrenteId') recurrenteId: string, @Req() req) {
    return this.recurrentesService.reanudarRecurrente(recurrenteId, req.user.id);
  }

  @Get('historial/estadisticas')
  async obtenerEstadisticas(
    @Req() req,
    @Query('filtro') filtro: 'año' | 'mes' | 'quincena' | 'semana' = 'mes'
  ) {
    return this.recurrentesService.obtenerEstadisticasHistorial(req.user.id, filtro);
  }
}
