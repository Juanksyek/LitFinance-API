import { Controller, Post, Body, Get, Req, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { RegisterAuthDto } from './dto/register-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto/change-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register')
  async register(@Body() dto: RegisterAuthDto): Promise<any> {
    return await this.authService.register(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginAuthDto): Promise<any> {
    return await this.authService.login(dto);
  }

  @Get('confirmar')
  async confirmar(@Query('token') token: string): Promise<any> {
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
    return this.authService.changePassword(req.user.sub, dto);
  }
}
// commit