import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req, UseGuards } from '@nestjs/common';
import { ConceptosService } from './conceptos.service';
import { CreateConceptoDto } from './dto/create-concepto.dto';
import { UpdateConceptoDto } from './dto/update-concepto.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SearchPaginationQueryDto } from '../common/dto/search-pagination-query.dto';
import { SearchProtectionService } from '../common/services/search-protection.service';

@UseGuards(JwtAuthGuard)
@Controller('conceptos')
export class ConceptosController {
  constructor(
    private readonly conceptosService: ConceptosService,
    private readonly searchProtectionService: SearchProtectionService,
  ) {}

  @Post()
  async crear(@Req() req, @Body() dto: CreateConceptoDto) {
    const concepto = await this.conceptosService.crear(dto, req.user.id);
    return concepto;
  }

  @Get()
  async listar(
    @Req() req,
    @Query() query: SearchPaginationQueryDto,
  ) {
    await this.searchProtectionService.guard({
      search: query.search,
      tracker: String(req.user?.id ?? req.ip ?? 'anonymous'),
      scope: 'conceptos',
    });

    return this.conceptosService.listar(
      req.user.id,
      Number(query.page ?? 1),
      Number(query.limit ?? 10),
      query.search,
    );
  }

  @Get(':rawSearch')
  async listarPorRuta(
    @Req() req,
    @Param('rawSearch') rawSearch: string,
    @Query() query: SearchPaginationQueryDto,
  ) {
    const normalizedSearch = decodeURIComponent(String(rawSearch ?? '')).trim();

    await this.searchProtectionService.guard({
      search: normalizedSearch,
      tracker: String(req.user?.id ?? req.ip ?? 'anonymous'),
      scope: 'conceptos',
    });

    return this.conceptosService.listar(
      req.user.id,
      Number(query.page ?? 1),
      Number(query.limit ?? 10),
      normalizedSearch,
    );
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Req() req, @Body() dto: UpdateConceptoDto) {
    return this.conceptosService.actualizar(id, req.user.id, dto);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string, @Req() req) {
    return this.conceptosService.eliminar(id, req.user.id);
  }
}
