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
  async crear(@Req() req, @Body() dto: Omit<CreateSubcuentaDto, 'cuentaId'> & { cuentaPrincipalId: string }) {
    const subcuentaDto = {
      ...dto,
      userId: req.user.id || req.user.sub,
    };
  
    const result = await this.subcuentaService.crear(subcuentaDto, subcuentaDto.userId);
  
    const response = result.toObject?.() ?? result;
    delete response.cuentaId;
  
    return {
      ...response,
      cuentaPrincipalId: dto.cuentaPrincipalId,
    };
  }

  @Get()
  async listar(
    @Req() req,
    @Query('cuentaPrincipalId') cuentaPrincipalId?: string,
    @Query('search') search?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.subcuentaService.listar(req.user.sub, cuentaPrincipalId, search, +page, +limit);
  }

  @Patch(':id')
  async actualizar(@Req() req, @Param('id') id: string, @Body() dto: UpdateSubcuentaDto) {
    return this.subcuentaService.actualizar(id, dto, req.user.sub);
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
    return this.subcuentaService.calcularParticipacion(cuentaId, req.user.sub);
  }
}
