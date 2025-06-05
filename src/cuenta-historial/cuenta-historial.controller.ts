import { Controller, Get, Post, Body, Query, Param, Delete, UseGuards } from '@nestjs/common';
import { CuentaHistorialService } from './cuenta-historial.service';
import { CreateCuentaHistorialDto } from './dto/create-cuenta-historial.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('cuenta-historial')
export class CuentaHistorialController {
    constructor(private readonly historialService: CuentaHistorialService) { }

    @Post()
    async registrar(@Body() dto: CreateCuentaHistorialDto) {
        return this.historialService.registrarMovimiento(dto);
    }

    @Get()
    async buscar(
        @Query('cuentaId') cuentaId: string,
        @Query('page') page = 1,
        @Query('limit') limit = 10,
        @Query('search') search?: string
    ) {
        return this.historialService.buscarHistorial(
            cuentaId,
            Number(page),
            Number(limit),
            search
        );
    }

    @Delete(':id')
    async eliminar(@Param('id') id: string) {
        return this.historialService.eliminar(id);
    }
}
