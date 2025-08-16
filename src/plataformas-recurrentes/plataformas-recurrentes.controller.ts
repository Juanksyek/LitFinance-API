import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, Query } from '@nestjs/common';
import { PlataformasRecurrentesService } from './plataformas-recurrentes.service';
import { CrearPlataformaDto } from './dto/crear-plataforma.dto';
import { EditarPlataformaDto } from './dto/editar-plataforma.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('plataformas-recurrentes')
export class PlataformasRecurrentesController {
  constructor(private readonly servicio: PlataformasRecurrentesService) {}

  @Post()
  async crear(@Body() dto: CrearPlataformaDto) {
    return this.servicio.crear(dto);
  }

  @Get()
  async listar(@Query('search') search?: string) {
    return this.servicio.listar(search);
  }

  @Patch(':plataformaId')
  async editar(@Param('plataformaId') plataformaId: string, @Body() dto: EditarPlataformaDto) {
    return this.servicio.editar(plataformaId, dto);
  }

  @Delete(':plataformaId')
  async eliminar(@Param('plataformaId') plataformaId: string) {
    return this.servicio.eliminar(plataformaId);
  }

  @Post('insertar-lote')
  async insertarLote(@Req() req, @Body() body: any) {
    const plataformas = Array.isArray(body?.plataformas) ? body.plataformas : [];
    return this.servicio.insertarPlataformasRecurrentes(plataformas, req.user);
  }
}