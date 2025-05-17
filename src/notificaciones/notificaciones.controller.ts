import { Controller, Post, Body } from '@nestjs/common';
import { NotificacionesService } from './notificaciones.service';

@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly notificacionesService: NotificacionesService) {}

  @Post('registrar-token')
  async registrar(@Body() body: {
    userId: string;
    token: string;
    plataforma: 'web' | 'android' | 'ios';
    appVersion?: string;
  }) {
    return this.notificacionesService.registrarToken(body.userId, body.token, body.plataforma, body.appVersion);
  }
}