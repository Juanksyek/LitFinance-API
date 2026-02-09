import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { AuthService } from './auth.service';

// Endpoint público para enlaces de activación enviados por correo.
// Nota: NO lleva prefijo /auth, porque el email históricamente usa /activate/:token
@Controller()
export class ActivationController {
  constructor(private readonly authService: AuthService) {}

  @Get('activate/:token')
  async activate(@Param('token') token: string) {
    if (!token) throw new BadRequestException('Token no proporcionado');
    return this.authService.confirmAccount(token);
  }
}
