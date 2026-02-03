import { Controller, Post, Get, Body, Param, Patch, Delete, Query, Req, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
  import { TransactionsService } from './transactions.service';
  import { CreateTransactionDto } from './dto/create-transaction.dto';
  import { UpdateTransactionDto } from './dto/update-transaction.dto';
  import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
  import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';
  
  @UseGuards(JwtAuthGuard)
  @Controller('transacciones')
  export class TransactionsController {
    constructor(
      private readonly transactionsService: TransactionsService,
      private readonly cuentaHistorialService: CuentaHistorialService,
    ) {}
  
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

    // Compat: editar un movimiento del historial (id corto) resolviendo su transaccionId
    @Patch('movimiento/:movimientoId')
    async editarDesdeMovimiento(
      @Param('movimientoId') movimientoId: string,
      @Body() dto: UpdateTransactionDto,
      @Req() req,
    ) {
      const movimiento = await this.cuentaHistorialService.findMovimientoById(movimientoId, req.user.id);
      if (!movimiento) throw new NotFoundException('Movimiento no encontrado');

      const transaccionId = movimiento?.metadata?.audit?.transaccionId;
      if (!transaccionId) throw new BadRequestException('Este movimiento no es editable como transacción');

      return this.transactionsService.editar(transaccionId, dto, req.user.id);
    }
  
    @Delete(':id')
    async eliminar(@Param('id') id: string, @Req() req) {
      return this.transactionsService.eliminar(id, req.user.id);
    }

    // Compat: eliminar un movimiento del historial (id corto) restaurando balances via transacción
    @Delete('movimiento/:movimientoId')
    async eliminarDesdeMovimiento(@Param('movimientoId') movimientoId: string, @Req() req) {
      return this.transactionsService.eliminarMovimiento(movimientoId, req.user.id);
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

    // Debug/compat: obtener una transacción por transaccionId o Mongo _id
    @Get(':id')
    async obtener(@Param('id') id: string, @Req() req) {
      return this.transactionsService.obtener(id, req.user.id);
    }
  }