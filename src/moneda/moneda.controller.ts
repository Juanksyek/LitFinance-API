import { UseGuards,Controller, Get, Query, Post, Body } from '@nestjs/common';
import { MonedaService } from './moneda.service';
import { CreateMonedaDto } from './dto/create.moneda.dto';
import { CatalogoMonedaDto } from './dto/catalogo-moneda.dto';
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
  async listar() {
    return this.monedaService.listarMonedas();
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
}
