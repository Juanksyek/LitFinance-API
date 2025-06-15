import { Controller, Post, Get, Body, Req, UseGuards, Query, Param, Patch, Delete } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubcuentaService } from './subcuenta.service';
import { CreateSubcuentaDto } from './dto/create-subcuenta.dto/create-subcuenta.dto';
import { UpdateSubcuentaDto } from './dto/update-subcuenta.dto/update-subcuenta.dto';

@UseGuards(JwtAuthGuard)
@Controller('subcuenta')
export class SubcuentaController {
  constructor(private readonly subcuentaService: SubcuentaService) {}

  @Post()
  async crear(@Req() req, @Body() dto: CreateSubcuentaDto) {
    return this.subcuentaService.crear(dto, req.user.sub);
  }

  @Get(':userId')
  async listarPorUserId(
    @Param('userId') userId: string,
    @Query('subCuentaId') subCuentaId?: string,
    @Query('search') search?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 4,
  ) {
    return this.subcuentaService.listar(userId, subCuentaId, search, +page, +limit);
  }

  @Get('buscar/:subCuentaId')
  async buscarPorSubCuentaId(@Param('subCuentaId') subCuentaId: string) {
    return this.subcuentaService.buscarPorSubCuentaId(subCuentaId);
  }

  @Patch(':id')
  async actualizar(@Req() req, @Param('id') id: string, @Body() dto: UpdateSubcuentaDto) {
    return this.subcuentaService.actualizar(id, dto);
  }

  @Delete(':id')
  async eliminar(@Req() req, @Param('id') id: string) {
    return this.subcuentaService.eliminar(id, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/historial')
  async obtenerHistorial(@Param('id') id: string, @Req() req) {
    return this.subcuentaService.obtenerHistorial(id, req.user.sub);
  }

  @Get('historial')
  async historialGeneral(@Req() req) {
    return this.subcuentaService.obtenerHistorial(null, req.user.sub);
  }

  @Patch(':id/activar')
  async activar(@Param('id') id: string, @Req() req) {
    return this.subcuentaService.activar(id, req.user.sub);
  }

  @Patch(':id/desactivar')
  async desactivar(@Req() req, @Param('id') id: string) {
    return this.subcuentaService.desactivar(id, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('participacion/:cuentaId')
  async calcularParticipacion(@Param('cuentaId') cuentaId: string, @Req() req) {
    return this.subcuentaService.calcularParticipacion(req.user.sub);
  }
}
