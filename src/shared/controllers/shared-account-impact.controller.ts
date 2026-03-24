import {
  Controller, Get, Post, Param, Body, Req,
  UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SharedAccountImpactService } from '../services/shared-account-impact.service';

@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@Controller('shared')
export class SharedAccountImpactController {
  constructor(private readonly impactService: SharedAccountImpactService) {}

  /** GET /shared/spaces/:spaceId/movements/:movementId/impact — Impactos del movimiento */
  @Get('spaces/:spaceId/movements/:movementId/impact')
  getByMovement(
    @Req() req,
    @Param('movementId') movementId: string,
  ) {
    return this.impactService.getByMovement(movementId);
  }

  /** POST /shared/spaces/:spaceId/movements/:movementId/impact/revert — Revertir impactos */
  @Post('spaces/:spaceId/movements/:movementId/impact/revert')
  revertAll(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('movementId') movementId: string,
  ) {
    return this.impactService.revertAllForMovement(movementId, spaceId, req.user.id, 'Manual revert');
  }

  /** POST /shared/impact/:impactId/resync — Resincronizar un impacto */
  @Post('impact/:impactId/resync')
  resync(
    @Req() req,
    @Param('impactId') impactId: string,
    @Body() body: { spaceId: string; newAmount: number; movementTitle?: string },
  ) {
    return this.impactService.resyncImpact({
      impactId,
      spaceId: body.spaceId,
      newAmount: body.newAmount,
      actorUserId: req.user.id,
      movementTitle: body.movementTitle,
    });
  }
}
