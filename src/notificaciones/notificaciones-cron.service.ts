import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificacionesService } from './notificaciones.service';

@Injectable()
export class NotificacionesCronService {
  private readonly logger = new Logger(NotificacionesCronService.name);

  constructor(
    private readonly notificacionesService: NotificacionesService,
  ) {}

  // Verificar usuarios inactivos todos los días a las 10:00 AM
  @Cron('0 10 * * *', { timeZone: 'America/Mexico_City' })
  async verificarUsuariosInactivos() {
    this.logger.log('🔍 [CRON 10:00 AM] Verificando usuarios inactivos (3+ días)...');
    
    try {
      const resultado = await this.notificacionesService.notificarUsuariosInactivos();
      this.logger.log(`✅ Notificaciones de inactividad enviadas: ${resultado.notificados}`);
    } catch (error) {
      this.logger.error('❌ Error verificando usuarios inactivos:', error);
    }
  }
}
