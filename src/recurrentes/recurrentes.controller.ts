import { Controller, Get, Req, Post, Body, Param, Put, Delete, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { RecurrentesService } from './recurrentes.service';
import { CrearRecurrenteDto } from './dto/crear-recurrente.dto';
import { EditarRecurrenteDto } from './dto/editar-recurrente.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('recurrentes')
export class RecurrentesController {
  constructor(
    private readonly recurrentesService: RecurrentesService,
  ) {}

  // Crear un nuevo recurrente
  @Post()
  async crear(@Req() req, @Body() dto: CrearRecurrenteDto) {
    const userId = req.user.sub;
    return this.recurrentesService.crear(dto, userId);
  }

  // Listar todos los recurrentes del usuario (pasar userId como query por ahora)
  @Get()
  async listar(
    @Req() req,
    @Query('search') search?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 6,
  ) {
    return this.recurrentesService.listar(req.user.sub, search, +page, +limit);
  }

  // Obtener un recurrente específico por su ID
  @Get(':recurrenteId')
  async obtener(@Param('recurrenteId') recurrenteId: string) {
    return this.recurrentesService.obtenerPorId(recurrenteId);
  }

  // Editar un recurrente
  @Put(':recurrenteId')
  async editar(@Param('recurrenteId') recurrenteId: string, @Body() dto: EditarRecurrenteDto) {
    return this.recurrentesService.editar(recurrenteId, dto);
  }

  // Eliminar un recurrente
  @Delete(':recurrenteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(@Param('recurrenteId') recurrenteId: string) {
    return this.recurrentesService.eliminar(recurrenteId);
  }

  // Endpoint opcional para forzar ejecución del día (útil para pruebas)
  @Post('/ejecutar/hoy')
  async ejecutarHoy() {
    const cantidad = await this.recurrentesService.ejecutarRecurrentesDelDia();
    return { ejecutados: cantidad };
  }
}
