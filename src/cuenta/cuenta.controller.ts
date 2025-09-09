import { Controller, Get, Body, Patch, UseGuards, Req, Query, Post } from '@nestjs/common';
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

  @UseGuards(JwtAuthGuard)
  @Get('preview-currency-change')
  async previewCurrencyChange(@Req() req, @Query('nuevaMoneda') nuevaMoneda: string) {
    return this.cuentaService.obtenerVistaPrevia(req.user.sub, nuevaMoneda);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync-currency')
  async syncCurrency(@Req() req) {
    await this.cuentaService.verificarSincronizacionMoneda(req.user.sub);
    return { 
      message: 'Sincronización de moneda completada',
      timestamp: new Date().toISOString()
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('editar-principal')
  async updateCuentaPrincipal(@Req() req, @Body() dto: UpdateCuentaDto) {
    const result = await this.cuentaService.editarCuentaPrincipal(req.user.sub, dto);
    return {
      ...result,
      intentosRestantes: result.intentosRestantes,
    };
  }
}
