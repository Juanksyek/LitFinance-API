import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CreditCardService } from './credit-card.service';

@Injectable()
export class CreditCardCronService {
  private readonly logger = new Logger(CreditCardCronService.name);

  constructor(private readonly creditCardService: CreditCardService) {}

  /**
   * Todos los días a las 9:00 AM (hora México):
   * 1. Envía recordatorios push de corte y pago pendientes.
   * 2. Avanza las fechas de ciclo de las tarjetas vencidas.
   */
  @Cron('0 9 * * *', { timeZone: 'America/Mexico_City' })
  async procesarRecordatoriosTarjetas(): Promise<void> {
    this.logger.log('🔔 [CRON 9:00 AM] Procesando recordatorios de tarjetas de crédito...');
    try {
      await this.creditCardService.enviarRecordatoriosPendientes();
      this.logger.log('✅ Recordatorios de tarjetas enviados.');
    } catch (err) {
      this.logger.error('❌ Error al enviar recordatorios de tarjetas:', err);
    }

    this.logger.log('🔄 [CRON 9:00 AM] Avanzando fechas de ciclo de tarjetas...');
    try {
      await this.creditCardService.avanzarFechasCiclo();
      this.logger.log('✅ Fechas de ciclo actualizadas.');
    } catch (err) {
      this.logger.error('❌ Error al avanzar fechas de ciclo:', err);
    }
  }
}
