import { Controller, Post, Get, Body, Param, Patch, Delete, Query, Req, UseGuards } from '@nestjs/common';
  import { TransactionsService } from './transactions.service';
  import { CreateTransactionDto } from './dto/create-transaction.dto';
  import { UpdateTransactionDto } from './dto/update-transaction.dto';
  import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
  
  @UseGuards(JwtAuthGuard)
  @Controller('transacciones')
  export class TransactionsController {
    constructor(private readonly transactionsService: TransactionsService) {}
  
    @Post()
    @UseGuards(JwtAuthGuard)
    async crear(@Req() req, @Body() dto: CreateTransactionDto) {
      return this.transactionsService.crear(dto, req.user.id);
    }
  
    @Patch(':id')
    async editar(
      @Param('id') id: string,
      @Body() dto: UpdateTransactionDto,
      @Req() req,
    ) {
      return this.transactionsService.editar(id, dto, req.user.id);
    }
  
    @Delete(':id')
    async eliminar(@Param('id') id: string, @Req() req) {
      return this.transactionsService.eliminar(id, req.user.id);
    }
  
    @Get()
        async listar(
          @Req() req,
          @Query('rango') rango?: string,
          @Query('fechaInicio') fechaInicio?: string,
          @Query('fechaFin') fechaFin?: string,
          @Query('moneda') moneda?: string,
          @Query('withTotals') withTotals?: string,
        ) {
          return this.transactionsService.listar(req.user.id, {
            rango,
            fechaInicio,
            fechaFin,
            moneda,
            withTotals: withTotals === 'true' || withTotals === '1',
          });
    }
  
    @Get('subcuenta/:id/historial')
    async historialSubcuenta(
      @Param('id') subCuentaId: string,
      @Query('desde') desde?: string,
      @Query('hasta') hasta?: string,
      @Query('limite') limite = 5,
      @Query('pagina') pagina = 1,
      @Query('descripcion') descripcion?: string,
    ) {
      return this.transactionsService.obtenerHistorial({
        subCuentaId,
        desde,
        hasta,
        limite: +limite,
        pagina: +pagina,
        descripcion,
      });
    }
  }