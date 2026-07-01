import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  Query,
  BadRequestException,
  UseGuards,
  Param,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { TooManyRequestsException } from '../common/exceptions/too-many-requests.exception';
import { AuthService } from './auth.service';
import { RegisterAuthDto } from './dto/register-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import { RefreshAuthDto } from './dto/refresh-auth.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto/change-password.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authRateLimitService: AuthRateLimitService,
  ) {}

  private async enforceRateLimit(
    scope: 'login' | 'register',
    req: Request,
    email?: string,
  ) {
    const normalizedEmail = String(email ?? '')
      .trim()
      .toLowerCase();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const rateLimit = await this.authRateLimitService.check(
      scope,
      `${normalizedEmail}:${ip}`,
    );

    if (!rateLimit.allowed) {
      throw new TooManyRequestsException({
        code: 'RATE_LIMITED',
        message: 'Too Many Requests',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }
  }

  @Post('register')
  async register(@Req() req: Request, @Body() dto: RegisterAuthDto): Promise<any> {
    await this.enforceRateLimit('register', req, dto?.email);
    return await this.authService.register(dto);
  }

  @Post('login')
  async login(@Req() req: Request, @Body() dto: LoginAuthDto): Promise<any> {
    await this.enforceRateLimit('login', req, dto?.email);
    return await this.authService.login(dto);
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshAuthDto) {
    return this.authService.refreshTokens(dto);
  }

  @Post('resend-activation')
  async resendActivation(@Body() body: { email: string }) {
    return this.authService.resendActivation(body?.email);
  }

  @Get('confirmar')
  async confirmar(@Query('token') token: string): Promise<any> {
    if (!token) throw new BadRequestException('Token no proporcionado');
    return await this.authService.confirmAccount(token);
  }

  // Compatibilidad con enlaces que apuntan directamente a /activate/:token
  @Get('activate/:token')
  async activateDirect(@Param('token') token: string) {
    if (!token) throw new BadRequestException('Token no proporcionado');
    return await this.authService.confirmAccount(token);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return await this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return await this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Req() req, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@Req() req, @Body() body: { deviceId: string }) {
    return this.authService.logout(req.user.id || req.user.sub, body.deviceId);
  }
}
