import { Controller, Post, Body, Delete, UseGuards, Request } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { NotificacionesService } from './notificaciones.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { 
  RegistrarExpoPushTokenDto,
  EnviarNotificacionDto,
  EnviarNotificacionTodosDto
} from './dto/notificacion.dto';

@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly notificacionesService: NotificacionesService) {}

  // Registrar token de EXPO para el usuario autenticado
  @UseGuards(JwtAuthGuard)
  @Post('expo/registrar')
  async registrarExpoPushToken(
    @Request() req,
    @Body() body: RegistrarExpoPushTokenDto
  ) {
    return this.notificacionesService.registrarExpoPushToken(req.user.id, body.expoPushToken);
  }

  // Eliminar token de EXPO
  @UseGuards(JwtAuthGuard)
  @Delete('expo/eliminar')
  async eliminarExpoPushToken(
    @Request() req,
    @Body() body: RegistrarExpoPushTokenDto
  ) {
    return this.notificacionesService.eliminarExpoPushToken(req.user.id, body.expoPushToken);
  }


  // Enviar notificación personalizada a un usuario específico
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('enviar')
  async enviarNotificacion(@Body() body: EnviarNotificacionDto) {
    return this.notificacionesService.enviarNotificacionPush(
      body.userId,
      body.titulo,
      body.mensaje,
      body.data
    );
  }


  // Enviar notificación a todos los usuarios (broadcast)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('enviar-todos')
  async enviarNotificacionATodos(@Body() body: EnviarNotificacionTodosDto) {
    return this.notificacionesService.enviarNotificacionATodos(
      body.titulo,
      body.mensaje,
      body.data
    );
  }

  // Forzar notificación de inactividad (para pruebas)
  @Post('notificar-inactivos')
  async notificarInactivos() {
    return this.notificacionesService.notificarUsuariosInactivos();
  }

  // [LEGACY] OneSignal (deprecado, mantener para compatibilidad)
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