import {
  Controller, Get, Post, Patch, Body, Param, Query, Req,
  UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SharedMovementsService } from '../services/shared-movements.service';
import { CreateSharedMovementDto, UpdateSharedMovementDto } from '../dto/shared-movement.dto';
import { SharedMovementQueryDto } from '../dto/shared-query.dto';

@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@Controller('shared/spaces/:spaceId/movements')
export class SharedMovementsController {
  constructor(private readonly movementsService: SharedMovementsService) {}

  /** POST /shared/spaces/:spaceId/movements — Crear movimiento */
  @Post()
  create(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Body() dto: CreateSharedMovementDto,
  ) {
    return this.movementsService.create(spaceId, req.user.id, dto);
  }

  /** GET /shared/spaces/:spaceId/movements — Listar movimientos */
  @Get()
  list(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Query() query: SharedMovementQueryDto,
  ) {
    return this.movementsService.list(spaceId, req.user.id, query);
  }

  /** GET /shared/spaces/:spaceId/movements/:movementId — Detalle */
  @Get(':movementId')
  getDetail(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('movementId') movementId: string,
  ) {
    return this.movementsService.getDetail(spaceId, movementId, req.user.id);
  }

  /** PATCH /shared/spaces/:spaceId/movements/:movementId — Editar */
  @Patch(':movementId')
  update(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('movementId') movementId: string,
    @Body() dto: UpdateSharedMovementDto,
  ) {
    return this.movementsService.update(spaceId, movementId, req.user.id, dto);
  }

  /** POST /shared/spaces/:spaceId/movements/:movementId/cancel — Cancelar */
  @Post(':movementId/cancel')
  cancel(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('movementId') movementId: string,
  ) {
    return this.movementsService.cancel(spaceId, movementId, req.user.id);
  }

  /** POST /shared/spaces/:spaceId/movements/:movementId/duplicate — Duplicar */
  @Post(':movementId/duplicate')
  duplicate(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('movementId') movementId: string,
  ) {
    return this.movementsService.duplicate(spaceId, movementId, req.user.id);
  }
}
