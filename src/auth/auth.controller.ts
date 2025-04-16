import { Controller, Post, Body, Get, Query, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterAuthDto } from './dto/register-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
