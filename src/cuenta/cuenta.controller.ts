import { Controller, Get, Body, Patch, UseGuards, Req } from '@nestjs/common';
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
  @Patch('editar-principal')
  async updateCuentaPrincipal(@Req() req, @Body() dto: UpdateCuentaDto) {
    return this.cuentaService.editarCuentaPrincipal(req.user.sub, dto);
  }
}
