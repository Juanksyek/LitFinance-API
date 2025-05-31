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
      return this.transactionsService.crear(dto, req.user.sub);
    }
  
    @Patch(':id')
    async editar(
      @Param('id') id: string,
      @Body() dto: UpdateTransactionDto,
      @Req() req,
    ) {
      return this.transactionsService.editar(id, dto, req.user.sub);
    }
  
    @Delete(':id')
    async eliminar(@Param('id') id: string, @Req() req) {
      return this.transactionsService.eliminar(id, req.user.sub);
    }
  
    @Get()
    async listar(@Req() req, @Query('rango') rango?: string) {
      return this.transactionsService.listar(req.user.sub, rango);
    }
  
    @Get('buscar')
    async buscar(
      @Req() req,
      @Query('concepto') concepto?: string,
      @Query('motivo') motivo?: string,
      @Query('monto') monto?: number,
    ) {
      return this.transactionsService.buscar(req.user.sub, {
        concepto,
        motivo,
        monto,
      });
    }
  }