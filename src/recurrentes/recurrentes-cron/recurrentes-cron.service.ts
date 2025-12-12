import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecurrentesService } from '../recurrentes.service';

@Injectable()
export class RecurrentesCronService {
  private readonly logger = new Logger(RecurrentesCronService.name);

  constructor(private readonly recurrentesService: RecurrentesService) {}

  // Ejecutar recurrentes todos los días a las 12:00 AM (medianoche)
  @Cron('0 0 * * *', { timeZone: 'America/Mexico_City' })
  async ejecutarRecurrentes() {
    this.logger.log('🕐 [CRON 12:00 AM] Iniciando ejecución de recurrentes del día...');
    
    try {
      const resultado = await this.recurrentesService.ejecutarRecurrentesDelDia();
      this.logger.log(
        `✅ Recurrentes ejecutados: ${resultado.ejecutados} | ` +
        `Exitosos: ${resultado.exitosos} | Fallidos: ${resultado.fallidos}`
      );
    } catch (error) {
      this.logger.error('❌ Error ejecutando recurrentes del día:', error);
    }
  }

  // Ejecutar recordatorios todos los días a las 9:00 AM
  @Cron('0 9 * * *', { timeZone: 'America/Mexico_City' })
  async ejecutarRecordatorios() {
    this.logger.log('🔔 [CRON 9:00 AM] Verificando recordatorios del día...');
    
    try {
      await this.recurrentesService.verificarRecordatoriosDelDia();
      this.logger.log('✅ Recordatorios procesados correctamente');
    } catch (error) {
      this.logger.error('❌ Error verificando recordatorios:', error);
    }
  }
}