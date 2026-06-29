import { Controller, Get, Post, Body, Query, Param, Delete, Req, UseGuards } from '@nestjs/common';
import { CuentaHistorialService } from './cuenta-historial.service';
import { CreateCuentaHistorialDto } from './dto/create-cuenta-historial.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HistorialQueryDto } from './dto/historial-query.dto';
import { SearchProtectionService } from '../common/services/search-protection.service';

@UseGuards(JwtAuthGuard)
@Controller('cuenta-historial')
export class CuentaHistorialController {
    constructor(
      private readonly historialService: CuentaHistorialService,
      private readonly searchProtectionService: SearchProtectionService,
    ) { }

    @Post()
    async registrar(@Body() dto: CreateCuentaHistorialDto) {
        return this.historialService.registrarMovimiento(dto);
    }

    @Get()
    async buscar(
        @Req() req,
        @Query() query: HistorialQueryDto,
    ) {
        await this.searchProtectionService.guard({
            search: query.search,
            tracker: String(req.user?.id ?? req.ip ?? 'anonymous'),
            scope: 'cuenta-historial',
        });

        return this.historialService.buscarHistorial(
            query.cuentaId,
            Number(query.page ?? 1),
            Number(query.limit ?? 10),
            query.search,
        );
    }

    @Delete(':id')
    async eliminar(@Param('id') id: string) {
        return this.historialService.eliminar(id);
    }
}
