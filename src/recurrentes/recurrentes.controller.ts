import { Controller, Get, Req, Post, Body, Param, Put, Delete, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { RecurrentesService } from './recurrentes.service';
import { CrearRecurrenteDto } from './dto/crear-recurrente.dto';
import { EditarRecurrenteDto } from './dto/editar-recurrente.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PlataformaRecurrente } from './schemas/plataforma-recurrente.schema';

@UseGuards(JwtAuthGuard)
@Controller('recurrentes')
export class RecurrentesController {
  constructor(
    private readonly recurrentesService: RecurrentesService,
    @InjectModel(PlataformaRecurrente.name)
    private readonly plataformaModel: Model<PlataformaRecurrente>,
  ) {}

  // Crear un nuevo recurrente
  @Post()
  async crear(@Req() req, @Body() dto: CrearRecurrenteDto) {
    const userId = req.user.sub;
    return this.recurrentesService.crear(dto, userId);
  }

  // Listar todos los recurrentes del usuario (pasar userId como query por ahora)
  @Get()
  async listar(@Req() req) {
    return this.recurrentesService.listar(req.user.sub);
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

  // Endpoint para insertar plataformas recurrentes
  @Post('plataformas')
  async insertarPlataformas(@Req() req, @Body() body: any) {
    const user = req.user;
    const plataformas = Array.isArray(body?.plataformas) ? body.plataformas : [];
    return this.recurrentesService.insertarPlataformasRecurrentes(plataformas, user, this.plataformaModel);
  }
}
