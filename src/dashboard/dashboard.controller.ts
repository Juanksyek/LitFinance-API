import { Controller, Get, Query, Req, Res, UseGuards, Headers, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';
import { DashboardRateLimitService } from './dashboard-rate-limit.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly rateLimit: DashboardRateLimitService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('snapshot')
  async snapshot(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('if-none-match') ifNoneMatch?: string,
    @Query('range') range?: 'week' | 'month' | 'year',
    @Query('recentLimit') recentLimit?: string,
  ) {
    const user: any = (req as any)?.user;
    const userId = user?.id;

    if (!userId) {
      throw new UnauthorizedException();
    }

    // User-based rate limit (suave) solo para este endpoint
    const rl = this.rateLimit.check(String(userId));
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: 'Too Many Requests',
        retryAfterSeconds: rl.retryAfterSeconds,
      });
    }

    const version = await this.dashboardService.getDashboardVersion(String(userId));
    const etag = `W/"${version}"`;

    // Aceptar varias formas de ETag (incluyendo lista separada por comas)
    const inm = (ifNoneMatch ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const matches = inm.includes(etag) || inm.includes(`"${version}"`) || inm.includes(version);

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('Vary', 'Authorization');

    if (matches) {
      return res.status(HttpStatus.NOT_MODIFIED).send();
    }

    const safeRange = range === 'week' || range === 'month' || range === 'year' ? range : undefined;
    const safeRecentLimit = recentLimit ? Number(recentLimit) : undefined;

    const snapshot = await this.dashboardService.getSnapshot(String(userId), version, {
      range: safeRange,
      recentLimit: safeRecentLimit,
    });

    return res.status(HttpStatus.OK).json(snapshot);
  }
}
