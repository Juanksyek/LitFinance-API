import { Controller, Get, Body, Patch, UseGuards, Req, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CuentaService } from './cuenta.service';
import { UpdateCuentaDto } from './dto/update-cuenta.dto/update-cuenta.dto';

@Controller('cuenta')
export class CuentaController {
  constructor(private readonly cuentaService: CuentaService) {}

  @UseGuards(JwtAuthGuard)
  @Get('principal')
  async getCuentaPrincipal(@Req() req) {
    return this.cuentaService.obtenerCuentaPrincipal(req.user.sub);
  }

  /**
   * Vista previa del cambio de moneda antes de ejecutarlo
   */
  @UseGuards(JwtAuthGuard)
  @Get('preview-currency-change')
  async previewCurrencyChange(@Req() req, @Query('nuevaMoneda') nuevaMoneda: string) {
    return this.cuentaService.obtenerVistaPrevia(req.user.sub, nuevaMoneda);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('editar-principal')
  async updateCuentaPrincipal(@Req() req, @Body() dto: UpdateCuentaDto) {
    return this.cuentaService.editarCuentaPrincipal(req.user.sub, dto);
  }
}
