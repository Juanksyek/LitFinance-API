import { BadRequestException, Controller, Get, Param, Req, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { Request, Response } from 'express';
import { sendSuccessResponse } from '../common/http/http-response.helper';

// Endpoint público para enlaces de activación enviados por correo.
// Nota: NO lleva prefijo /auth, porque el email históricamente usa /activate/:token
@Controller()
export class ActivationController {
  constructor(private readonly authService: AuthService) {}

  @Get('activate/:token')
  async activate(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!token) throw new BadRequestException('Token no proporcionado');

    const result = await this.authService.confirmAccount(token);

    // Si tenemos URL de frontend, redirigimos para que el usuario termine en la web.
    const frontendBaseUrl = process.env.FRONTEND_URL || process.env.APP_URL;
    if (frontendBaseUrl) {
      const base = frontendBaseUrl.replace(/\/$/, '');
      const redirectUrl = `${base}/activate/${encodeURIComponent(token)}`;
      return res.redirect(302, redirectUrl);
    }

    // Fallback: devolver JSON si no hay frontend configurado
    return sendSuccessResponse(req, res, result);
  }
}
