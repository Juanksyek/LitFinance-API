import { UseGuards,Controller, Get, Query, Post, Body } from '@nestjs/common';
import { MonedaService } from './moneda.service';
import { CreateMonedaDto } from './dto/create.moneda.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('monedas')
export class MonedaController {
  constructor(private readonly monedaService: MonedaService) {}

  @Get()
  async listar() {
    return this.monedaService.listarMonedas();
  }

  @Post()
  async crear(@Body() dto: CreateMonedaDto) {
    return this.monedaService.crearMoneda(dto);
  }

  @Get('tasa-cambio')
  async tasaCambio(@Query('base') base: string, @Query('destino') destino: string) {
    return this.monedaService.obtenerTasaCambio(base, destino);
  }

  @Get('intercambiar')
  async intercambiar(
    @Query('monto') monto: number,
    @Query('base') base: string,
    @Query('destino') destino: string,
  ) {
    return this.monedaService.intercambiarDivisa(Number(monto), base, destino);
  }

  @Post('poblar')
  async poblar(@Body() divisas: CreateMonedaDto[]) {
    return this.monedaService.poblarCatalogoDivisas(divisas);
  }
}
