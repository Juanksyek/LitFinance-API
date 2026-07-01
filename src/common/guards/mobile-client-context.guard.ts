import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  AppPlatform,
  AppVersionValidation,
  ClientContext,
} from '../http/client-context.types';
import { versionService } from '../../services/versionService';

const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{6,128}$/;
const APP_VERSION_PATTERN = /^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/;

type RequestWithClientContext = Request & {
  clientContext?: ClientContext;
};

@Injectable()
export class MobileClientContextGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithClientContext>();
    const response = http.getResponse<Response>();

    const deviceId = String(request.headers['x-device-id'] ?? '').trim();
    if (!deviceId) {
      throw new BadRequestException({
        code: 'DEVICE_ID_REQUIRED',
        message: 'X-Device-ID es requerido.',
      });
    }

    if (!DEVICE_ID_PATTERN.test(deviceId)) {
      throw new BadRequestException({
        code: 'INVALID_DEVICE_ID',
        message: 'X-Device-ID tiene un formato inválido.',
      });
    }

    const appVersion = String(request.headers['x-app-version'] ?? '').trim();
    if (!appVersion) {
      throw new BadRequestException({
        code: 'APP_VERSION_REQUIRED',
        message: 'X-App-Version es requerido.',
      });
    }

    if (!APP_VERSION_PATTERN.test(appVersion)) {
      throw new BadRequestException({
        code: 'INVALID_APP_VERSION_FORMAT',
        message: 'X-App-Version debe tener formato semántico válido.',
      });
    }

    const rawPlatform = String(request.headers['x-platform'] ?? '')
      .trim()
      .toLowerCase();
    if (rawPlatform !== 'android' && rawPlatform !== 'ios') {
      throw new BadRequestException({
        code: 'INVALID_APP_PLATFORM',
        message: 'X-Platform debe ser "android" o "ios".',
      });
    }

    const platform = rawPlatform as AppPlatform;
    const appBuild = String(request.headers['x-app-build'] ?? '').trim() || null;

    const validation = (await versionService.validateVersion(
      appVersion,
      platform,
    )) as AppVersionValidation;

    if (!validation.isValid || validation.forceUpdate) {
      throw new ForbiddenException({
        code: 'APP_VERSION_UNSUPPORTED',
        message:
          validation.message ??
          'La versión actual de la app no es compatible y requiere actualización.',
        details: {
          platform,
          appVersion,
          appBuild,
          latestVersion: validation.latestVersion ?? null,
          minRequiredVersion: validation.minRequiredVersion ?? null,
          storeUrl: validation.storeUrl ?? null,
          forceUpdate: validation.forceUpdate,
        },
      });
    }

    if (validation.needsUpdate) {
      response.setHeader('x-app-update-available', '1');
      if (validation.latestVersion) {
        response.setHeader('x-latest-app-version', validation.latestVersion);
      }
    }

    request.clientContext = {
      deviceId,
      appVersion,
      appBuild,
      platform,
      versionValidation: validation,
    };

    return true;
  }
}
