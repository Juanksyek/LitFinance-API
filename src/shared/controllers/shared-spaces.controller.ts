import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Req, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SharedSpacesService } from '../services/shared-spaces.service';
import { CreateSharedSpaceDto, UpdateSharedSpaceDto } from '../dto/shared-space.dto';

@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@Controller('shared/spaces')
export class SharedSpacesController {
  constructor(private readonly spacesService: SharedSpacesService) {}

  /** POST /shared/spaces — Crear espacio compartido */
  @Post()
  create(@Req() req, @Body() dto: CreateSharedSpaceDto) {
    return this.spacesService.create(req.user.id, dto);
  }

  /** GET /shared/spaces — Listar espacios del usuario */
  @Get()
  list(@Req() req) {
    return this.spacesService.listByUser(req.user.id);
  }

  /** GET /shared/spaces/:spaceId — Detalle del espacio con miembros */
  @Get(':spaceId')
  getDetail(@Req() req, @Param('spaceId') spaceId: string) {
    return this.spacesService.getDetail(spaceId, req.user.id);
  }

  /** PATCH /shared/spaces/:spaceId — Actualizar espacio */
  @Patch(':spaceId')
  update(@Req() req, @Param('spaceId') spaceId: string, @Body() dto: UpdateSharedSpaceDto) {
    return this.spacesService.update(spaceId, req.user.id, dto);
  }

  /** DELETE /shared/spaces/:spaceId — Archivar espacio */
  @Delete(':spaceId')
  archive(@Req() req, @Param('spaceId') spaceId: string) {
    return this.spacesService.archive(spaceId, req.user.id);
  }
}
