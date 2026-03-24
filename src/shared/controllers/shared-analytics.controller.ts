import {
  Controller, Get, Param, Query, Req,
  UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SharedAnalyticsService } from '../services/shared-analytics.service';
import { SharedMembersService } from '../services/shared-members.service';
import { AnalyticsQueryDto } from '../dto/shared-query.dto';

@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@Controller('shared/spaces/:spaceId/analytics')
export class SharedAnalyticsController {
  constructor(
    private readonly analyticsService: SharedAnalyticsService,
    private readonly membersService: SharedMembersService,
  ) {}

  /** GET /shared/spaces/:spaceId/analytics/summary — Resumen general */
  @Get('summary')
  async summary(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    await this.membersService.requireActiveMember(spaceId, req.user.id);
    return this.analyticsService.summary(spaceId, query);
  }

  /** GET /shared/spaces/:spaceId/analytics/by-member — Análisis por miembro */
  @Get('by-member')
  async byMember(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    await this.membersService.requireActiveMember(spaceId, req.user.id);
    return this.analyticsService.byMember(spaceId, query);
  }

  /** GET /shared/spaces/:spaceId/analytics/by-category — Análisis por categoría */
  @Get('by-category')
  async byCategory(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    await this.membersService.requireActiveMember(spaceId, req.user.id);
    return this.analyticsService.byCategory(spaceId, query);
  }

  /** GET /shared/spaces/:spaceId/analytics/trends — Tendencias */
  @Get('trends')
  async trends(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    await this.membersService.requireActiveMember(spaceId, req.user.id);
    return this.analyticsService.trends(spaceId, query);
  }

  /** GET /shared/spaces/:spaceId/analytics/balance — Balance completo */
  @Get('balance')
  async balance(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    await this.membersService.requireActiveMember(spaceId, req.user.id);
    return this.analyticsService.balance(spaceId, query);
  }
}
