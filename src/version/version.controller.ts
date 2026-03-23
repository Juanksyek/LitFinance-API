import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { versionService } from '../services/versionService';

type Platform = 'android' | 'ios';

@Controller('version')
export class VersionController {
  @Post('validate')
  async validate(
    @Body()
    body: {
      currentVersion?: string;
      platform?: Platform;
    },
  ) {
    const currentVersion = (body?.currentVersion ?? '').trim();
    const platform = body?.platform;

    if (!currentVersion) {
      throw new BadRequestException('currentVersion is required');
    }
    if (platform !== 'android' && platform !== 'ios') {
      throw new BadRequestException("platform must be 'android' or 'ios'");
    }

    return versionService.validateVersion(currentVersion, platform);
  }

  @Get('latest')
  async latest(@Query('platform') platform?: Platform) {
    if (platform && platform !== 'android' && platform !== 'ios') {
      throw new BadRequestException("platform must be 'android' or 'ios'");
    }

    const latest = await versionService.getLatestVersion(platform);
    return {
      latest,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('config')
  async upsertConfig(
    @Body()
    body: {
      version?: string;
      minRequiredVersion?: string;
      forceUpdate?: boolean;
      platform?: 'android' | 'ios' | 'both';
      isActive?: boolean;
      storeUrls?: { playStore?: string; appStore?: string };
      releaseNotes?: string;
      releaseDate?: string | Date;
    },
  ) {
    const version = (body?.version ?? '').trim();
    const minRequiredVersion = (body?.minRequiredVersion ?? '').trim();

    if (!version) {
      throw new BadRequestException('version is required');
    }
    if (!minRequiredVersion) {
      throw new BadRequestException('minRequiredVersion is required');
    }

    const platform = body?.platform ?? 'both';
    if (platform !== 'android' && platform !== 'ios' && platform !== 'both') {
      throw new BadRequestException("platform must be 'android', 'ios', or 'both'");
    }

    const releaseDate =
      body?.releaseDate !== undefined && body?.releaseDate !== null
        ? new Date(body.releaseDate)
        : undefined;

    if (releaseDate && Number.isNaN(releaseDate.getTime())) {
      throw new BadRequestException('releaseDate must be a valid date');
    }

    return versionService.createOrUpdateVersion({
      version,
      minRequiredVersion,
      forceUpdate: !!body?.forceUpdate,
      platform,
      isActive: body?.isActive ?? true,
      storeUrls: body?.storeUrls,
      releaseNotes: body?.releaseNotes,
      releaseDate: releaseDate as any,
    } as any);
  }
}
