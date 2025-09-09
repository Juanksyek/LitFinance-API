import { UseGuards, Controller, Get, Query, Post, Body, Req } from '@nestjs/common';
import { MonedaService } from './moneda.service';
import { CreateMonedaDto } from './dto/create.moneda.dto';
import { CatalogoMonedaDto } from './dto/catalogo-moneda.dto';
import { ToggleFavoritaMonedaDto } from './dto/toggle-favorita-moneda.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('monedas')
export class MonedaController {
  constructor(private readonly monedaService: MonedaService) {}

  @Get('catalogo')
  async obtenerCatalogo(): Promise<CatalogoMonedaDto[]> {
    return this.monedaService.obtenerCatalogoPublico();
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async listar(@Req() req: any) {
    const userId = req.user?.userId || req.user?.sub;
    return this.monedaService.listarMonedasConFavoritas(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('favoritas')
  async obtenerFavoritas(@Req() req: any) {
    const userId = req.user?.userId || req.user?.sub;
    const resultado = await this.monedaService.listarMonedasConFavoritas(userId);
    return {
      favoritas: resultado.favoritas,
      totalFavoritas: resultado.totalFavoritas,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async crear(@Body() dto: CreateMonedaDto) {
    return this.monedaService.crearMoneda(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('tasa-cambio')
  async tasaCambio(@Query('base') base: string, @Query('destino') destino: string) {
    return this.monedaService.obtenerTasaCambio(base, destino);
  }

  @UseGuards(JwtAuthGuard)
  @Get('intercambiar')
  async intercambiar(
    @Query('monto') monto: number,
    @Query('base') base: string,
    @Query('destino') destino: string,
  ) {
    return this.monedaService.intercambiarDivisa(Number(monto), base, destino);
  }

  @UseGuards(JwtAuthGuard)
  @Post('poblar')
  async poblar(@Body() divisas: CreateMonedaDto[]) {
    return this.monedaService.poblarCatalogoDivisas(divisas);
  }

  @UseGuards(JwtAuthGuard)
  @Post('toggle-favorita')
  async toggleFavorita(@Req() req: any, @Body() dto: ToggleFavoritaMonedaDto) {
    const userId = req.user?.userId || req.user?.sub;
    const { codigoMoneda } = dto;
    return this.monedaService.toggleFavorita(userId, codigoMoneda);
  }
}