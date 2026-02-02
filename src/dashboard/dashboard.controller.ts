import { Controller, Get, Query, Req, Res, UseGuards, Headers, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';
import { DashboardRateLimitService } from './dashboard-rate-limit.service';
import { AuthService } from '../auth/auth.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly rateLimit: DashboardRateLimitService,
    private readonly authService: AuthService,
  ) {}

  private decodeJwtPayload(token: string): any | null {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
      const json = Buffer.from(padded, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  private async maybeRefreshSession(params: {
    authorization?: string;
    refreshToken?: string;
    deviceId?: string;
    res: Response;
  }) {
    const authorization = params.authorization ?? '';
    const refreshToken = (params.refreshToken ?? '').trim();
    const deviceId = (params.deviceId ?? 'default').trim() || 'default';

    if (!authorization.toLowerCase().startsWith('bearer ')) return;
    if (!refreshToken) return;

    const accessToken = authorization.slice(7).trim();
    const payload = this.decodeJwtPayload(accessToken);
    const expSeconds = typeof payload?.exp === 'number' ? payload.exp : null;
    if (!expSeconds) return;

    const msLeft = expSeconds * 1000 - Date.now();
    const refreshWhenLeftMs = 2 * 60 * 1000; // 2 min
    if (msLeft > refreshWhenLeftMs) return;

    try {
      const refreshed = await this.authService.refreshTokens({ refreshToken, deviceId } as any);

      if (refreshed?.accessToken) {
        params.res.setHeader('Authorization', `Bearer ${refreshed.accessToken}`);
        params.res.setHeader('x-access-token', refreshed.accessToken);
      }
      if (refreshed?.refreshToken) {
        params.res.setHeader('x-refresh-token', refreshed.refreshToken);
      }
      params.res.setHeader('x-session-refreshed', '1');
    } catch {
      // Best-effort: si falla el refresh no bloqueamos el dashboard.
    }
  }

  private normalizeRange(value?: string): 'day' | 'week' | 'month' | '3months' | '6months' | 'year' | 'all' | undefined {
    if (!value) return undefined;
    const raw = String(value).trim();
    if (!raw) return undefined;

    const lower = raw.toLowerCase();
    const compact = lower.replace(/\s+/g, '');

    if (compact === 'day' || compact === 'dia') return 'day';
    if (compact === 'week' || compact === 'semana') return 'week';
    if (compact === 'month' || compact === 'mes') return 'month';
    if (compact === '3months' || compact === '3meses') return '3months';
    if (compact === '6months' || compact === '6meses') return '6months';
    if (compact === 'year' || compact === 'año' || compact === 'ano') return 'year';

    // "Desde siempre" (all time)
    if (compact === 'all' || compact === 'siempre' || compact === 'desdesiempre') return 'all';
    if (lower === 'desde siempre') return 'all';

    return undefined;
  }

  private normalizePeriodoBalance(
    value?: string,
  ):
    | 'dia'
    | 'semana'
    | 'mes'
    | '3meses'
    | '6meses'
    | 'año'
    | undefined {
    if (!value) return undefined;
    const raw = String(value).trim();
    if (!raw) return undefined;

    const lower = raw.toLowerCase();
    const compact = lower.replace(/\s+/g, '');

    // Aceptar español y algunos equivalentes en inglés
    if (compact === 'dia' || compact === 'day') return 'dia';
    if (compact === 'semana' || compact === 'week') return 'semana';
    if (compact === 'mes' || compact === 'month') return 'mes';
    if (compact === '3meses' || compact === '3months') return '3meses';
    if (compact === '6meses' || compact === '6months') return '6meses';
    if (compact === 'año' || compact === 'ano' || compact === 'year') return 'año';

    return undefined;
  }

  @UseGuards(JwtAuthGuard)
  @Get('expenses-chart')
  async expensesChart(
    @Req() req: Request,
    @Res() res: Response,
    @Query('range') range?: string,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('tipoTransaccion') tipoTransaccion?: 'ingreso' | 'egreso' | 'ambos',
    @Query('moneda') moneda?: string,
  ) {
    const user: any = (req as any)?.user;
    const userId = user?.id;

    if (!userId) {
      throw new UnauthorizedException();
    }

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

    const safeRange = this.normalizeRange(range);
    const payload = await this.dashboardService.getExpensesChart(String(userId), {
      range: safeRange,
      fechaInicio,
      fechaFin,
      tipoTransaccion,
      moneda,
    });

    return res.status(HttpStatus.OK).json(payload);
  }

  @UseGuards(JwtAuthGuard)
  @Get('balance-card')
  async balanceCard(
    @Req() req: Request,
    @Res() res: Response,
    @Query('periodo') periodo?: string,
    @Query('moneda') moneda?: string,
  ) {
    const user: any = (req as any)?.user;
    const userId = user?.id;

    if (!userId) {
      throw new UnauthorizedException();
    }

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

    const safePeriodo = this.normalizePeriodoBalance(periodo) ?? 'mes';
    const payload = await this.dashboardService.getBalanceCard(String(userId), {
      periodo: safePeriodo,
      moneda,
    });

    return res.status(HttpStatus.OK).json(payload);
  }

  @UseGuards(JwtAuthGuard)
  @Get('totals')
  async totals(@Req() req: Request, @Res() res: Response) {
    const user: any = (req as any)?.user;
    const userId = user?.id;

    if (!userId) {
      throw new UnauthorizedException();
    }

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

    const payload = await this.dashboardService.getTotals(String(userId));
    return res.status(HttpStatus.OK).json(payload);
  }

  @UseGuards(JwtAuthGuard)
  @Get('snapshot')
  async snapshot(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('if-none-match') ifNoneMatch?: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-refresh-token') refreshToken?: string,
    @Headers('x-device-id') deviceId?: string,
    @Query('range') range?: string,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('tipoTransaccion') tipoTransaccion?: 'ingreso' | 'egreso' | 'ambos',
    @Query('moneda') moneda?: string,
    @Query('recentLimit') recentLimit?: string,
    @Query('recentPage') recentPage?: string,
    @Query('subaccountsLimit') subaccountsLimit?: string,
    @Query('subaccountsPage') subaccountsPage?: string,
    @Query('recurrentesLimit') recurrentesLimit?: string,
    @Query('recurrentesPage') recurrentesPage?: string,
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

    // "Inicio de sesión perpetuo" (best-effort):
    // si el access token está por expirar y el cliente manda refresh token,
    // devolvemos tokens nuevos en headers.
    await this.maybeRefreshSession({
      authorization,
      refreshToken,
      deviceId,
      res,
    });

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

    const safeRecentPage = recentPage ? Number(recentPage) : undefined;
    const safeSubaccountsPage = subaccountsPage ? Number(subaccountsPage) : undefined;
    const safeRecurrentesPage = recurrentesPage ? Number(recurrentesPage) : undefined;

    const isFirstPageRequest =
      (safeRecentPage === undefined || safeRecentPage <= 1) &&
      (safeSubaccountsPage === undefined || safeSubaccountsPage <= 1) &&
      (safeRecurrentesPage === undefined || safeRecurrentesPage <= 1);

    // Importante: si el cliente pide páginas > 1, siempre devolvemos 200 (aunque el ETag coincida)
    // para evitar 304 sin body en requests que no estén cacheadas localmente.
    if (matches && isFirstPageRequest) {
      return res.status(HttpStatus.NOT_MODIFIED).send();
    }

    const safeRange = this.normalizeRange(range);
    const safeRecentLimit = recentLimit ? Number(recentLimit) : undefined;
    const safeSubaccountsLimit = subaccountsLimit ? Number(subaccountsLimit) : undefined;
    const safeRecurrentesLimit = recurrentesLimit ? Number(recurrentesLimit) : undefined;

    const snapshot = await this.dashboardService.getSnapshot(String(userId), version, {
      range: safeRange,
      fechaInicio,
      fechaFin,
      tipoTransaccion,
      moneda,
      recentLimit: safeRecentLimit,
      recentPage: safeRecentPage,
      subaccountsLimit: safeSubaccountsLimit,
      subaccountsPage: safeSubaccountsPage,
      recurrentesLimit: safeRecurrentesLimit,
      recurrentesPage: safeRecurrentesPage,
    });

    return res.status(HttpStatus.OK).json(snapshot);
  }
}
