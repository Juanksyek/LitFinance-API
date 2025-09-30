import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req, UseGuards } from '@nestjs/common';
import { ConceptosService } from './conceptos.service';
import { CreateConceptoDto } from './dto/create-concepto.dto';
import { UpdateConceptoDto } from './dto/update-concepto.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('conceptos')
export class ConceptosController {
  constructor(private readonly conceptosService: ConceptosService) {}

  @Post()
  async crear(@Req() req, @Body() dto: CreateConceptoDto) {
    const concepto = await this.conceptosService.crear(dto, req.user.sub);
    return concepto;
  }

  @Get()
  listar(
    @Req() req,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('search') search?: string,
  ) {
    return this.conceptosService.listar(req.user.sub, Number(page), Number(limit), search);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Req() req, @Body() dto: UpdateConceptoDto) {
    return this.conceptosService.actualizar(id, req.user.sub, dto);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string, @Req() req) {
    return this.conceptosService.eliminar(id, req.user.sub);
  }
}
