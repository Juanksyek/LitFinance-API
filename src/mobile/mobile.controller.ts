import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { MobileClientContextGuard } from '../common/guards/mobile-client-context.guard';
import { ClientContext } from '../common/http/client-context.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  sendErrorResponse,
  sendSuccessResponse,
} from '../common/http/http-response.helper';
import { MobileRateLimitService } from './mobile-rate-limit.service';
import { MobileSyncPushDto } from './dto/mobile-sync-push.dto';
import { MobilePushService } from './mobile-push.service';
import { MobileSyncQueryDto } from './dto/mobile-sync-query.dto';
import { MobileService } from './mobile.service';

@Controller('mobile')
export class MobileController {
  constructor(
    private readonly mobileService: MobileService,
    private readonly mobilePushService: MobilePushService,
    private readonly rateLimitService: MobileRateLimitService,
  ) {}

  private respondRateLimited(
    req: Request,
    res: Response,
    retryAfterSeconds: number,
  ) {
    return sendErrorResponse(req, res, {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      retryAfterSeconds,
      code: 'RATE_LIMITED',
      message: 'Too Many Requests',
      retryable: true,
      path: req.url,
    });
  }

  private extractBootstrapData(payload: Record<string, unknown>) {
    const { serverTime, bootstrapVersion, ...data } = payload;
    return {
      data,
      meta: {
        ...(typeof serverTime === 'string' ? { serverTime } : {}),
        ...(typeof bootstrapVersion === 'string'
          ? { bootstrapVersion }
          : {}),
      },
    };
  }

  private extractSyncData(payload: Record<string, unknown>) {
    const { serverTime, meta, ...data } = payload;
    return {
      data,
      meta: {
        ...(meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}),
        ...(typeof serverTime === 'string' ? { serverTime } : {}),
      },
    };
  }

  private extractPushData(payload: { serverTime: string; results: unknown[] }) {
    return {
      data: {
        results: payload.results,
      },
      meta: {
        serverTime: payload.serverTime,
      },
    };
  }

  private getClientContext(req: Request): ClientContext {
    return ((req as any)?.clientContext ?? null) as ClientContext;
  }

  private buildBootstrapAppMeta(clientContext: ClientContext | null) {
    if (!clientContext) {
      return {};
    }

    return {
      currentVersion: clientContext.appVersion,
      build: clientContext.appBuild,
      platform: clientContext.platform,
      minVersion: clientContext.versionValidation.minRequiredVersion ?? null,
      latestVersion: clientContext.versionValidation.latestVersion ?? null,
      forceUpdate: clientContext.versionValidation.forceUpdate,
      updateAvailable: clientContext.versionValidation.needsUpdate,
      storeUrl: clientContext.versionValidation.storeUrl ?? null,
    };
  }

  @UseGuards(JwtAuthGuard, MobileClientContextGuard)
  @Get('bootstrap')
  async bootstrap(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const user = (req as any)?.user;
    const userId = user?.id;
    const clientContext = this.getClientContext(req);

    if (!userId) {
      throw new UnauthorizedException();
    }

    const keySeed = `${String(userId)}:${clientContext.deviceId}`;
    const rateLimit = await this.rateLimitService.check(keySeed, 'bootstrap');
    if (!rateLimit.allowed) {
      return this.respondRateLimited(req, res, rateLimit.retryAfterSeconds);
    }

    const bootstrapVersion = await this.mobileService.getBootstrapVersion(String(userId));
    const etag = `W/"${bootstrapVersion}"`;
    const inm = (ifNoneMatch ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const matches =
      inm.includes(etag) ||
      inm.includes(`"${bootstrapVersion}"`) ||
      inm.includes(bootstrapVersion);

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('Vary', 'Authorization, X-Device-ID');

    if (matches) {
      return res.status(HttpStatus.NOT_MODIFIED).send();
    }

    const payload = await this.mobileService.getBootstrap(
      String(userId),
      bootstrapVersion,
    );
    const normalized = this.extractBootstrapData(payload);
    const existingApp =
      normalized.data && typeof normalized.data === 'object'
        ? (normalized.data as Record<string, unknown>).app
        : null;
    const app =
      existingApp && typeof existingApp === 'object'
        ? {
            ...(existingApp as Record<string, unknown>),
            ...this.buildBootstrapAppMeta(clientContext),
          }
        : this.buildBootstrapAppMeta(clientContext);
    const responseData =
      normalized.data && typeof normalized.data === 'object'
        ? {
            ...(normalized.data as Record<string, unknown>),
            app,
          }
        : normalized.data;

    return sendSuccessResponse(req, res, responseData, normalized.meta);
  }

  @UseGuards(JwtAuthGuard, MobileClientContextGuard)
  @Get('sync')
  async sync(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: MobileSyncQueryDto,
  ) {
    const user = (req as any)?.user;
    const userId = user?.id;
    const clientContext = this.getClientContext(req);

    if (!userId) {
      throw new UnauthorizedException();
    }

    const keySeed = `${String(userId)}:${clientContext.deviceId}`;
    const rateLimit = await this.rateLimitService.check(keySeed, 'sync');
    if (!rateLimit.allowed) {
      return this.respondRateLimited(req, res, rateLimit.retryAfterSeconds);
    }

    const payload = await this.mobileService.getSync(
      String(userId),
      query.since,
      Number(query.limit ?? 100),
      query.cursor,
    );

    const normalized = this.extractSyncData(payload);
    return sendSuccessResponse(req, res, normalized.data, normalized.meta);
  }

  @UseGuards(JwtAuthGuard, MobileClientContextGuard)
  @Post('sync/push')
  async syncPush(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: MobileSyncPushDto,
  ) {
    const user = (req as any)?.user;
    const userId = user?.id;
    const clientContext = this.getClientContext(req);

    if (!userId) {
      throw new UnauthorizedException();
    }

    const bodyDeviceId = String(body.deviceId || '').trim();
    if (bodyDeviceId && bodyDeviceId !== clientContext.deviceId) {
      throw new BadRequestException({
        code: 'DEVICE_ID_MISMATCH',
        message: 'El deviceId del body no coincide con X-Device-ID.',
      });
    }

    const deviceId = clientContext.deviceId;
    const keySeed = `${String(userId)}:${deviceId}`;
    const rateLimit = await this.rateLimitService.check(keySeed, 'sync-push');
    if (!rateLimit.allowed) {
      return this.respondRateLimited(req, res, rateLimit.retryAfterSeconds);
    }

    const payload = await this.mobilePushService.processBatch({
      userId: String(userId),
      deviceId,
      operations: body.operations,
    });

    const normalized = this.extractPushData(payload);
    return sendSuccessResponse(req, res, normalized.data, normalized.meta);
  }
}
