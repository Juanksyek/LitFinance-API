import { Controller, UseGuards, Post, Get, Body, Param, Req, Delete, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CuentaHistorialService } from './cuenta-historial.service';
import { CreateCuentaHistorialDto } from './dto/create-cuenta-historial.dto';

@Controller('cuenta-historial')
export class CuentaHistorialController {
  constructor(private readonly historialService: CuentaHistorialService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async registrar(@Body() dto: CreateCuentaHistorialDto) {
    return this.historialService.registrarMovimiento(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async listar(@Req() req, @Query('page') page = 1, @Query('limit') limit = 10, @Query('search') search?: string) {
    return this.historialService.buscarHistorial(req.user.sub, +page, +limit, search);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async eliminar(@Param('id') id: string) {
    return this.historialService.eliminar(id);
  }
}
