import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MonedaService } from './moneda.service';

@Injectable()
export class MonedaCronService {
  private readonly logger = new Logger(MonedaCronService.name);

  constructor(private readonly monedaService: MonedaService) {}

  /**
   * Actualiza todas las tasas de cambio diariamente a las 6:00 AM (hora de México)
   * Las tasas se obtienen desde la API de ExchangeRate
   */
  @Cron('0 6 * * *', { timeZone: 'America/Mexico_City' })
  async actualizarTasasDiarias() {
    this.logger.log('🔄 Iniciando actualización diaria de tasas de cambio...');
    
    try {
      const resultado = await this.monedaService.actualizarTodasLasTasas();
      
      this.logger.log(
        `✅ Tasas actualizadas: ${resultado.actualizadas} monedas`,
      );
      
      if (resultado.errores.length > 0) {
        this.logger.warn(
          `⚠️  Errores al actualizar algunas monedas: ${resultado.errores.join(', ')}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ Error al actualizar tasas de cambio: ${error.message}`,
      );
    }
  }

  /**
   * Actualiza las tasas cada 6 horas (opcional, para mayor precisión)
   * Descomenta si necesitas actualizaciones más frecuentes
   */
  // @Cron('0 */6 * * *', { timeZone: 'America/Mexico_City' })
  // async actualizarTasasCada6Horas() {
  //   this.logger.log('🔄 Actualización periódica (cada 6 horas) de tasas...');
  //   await this.actualizarTasasDiarias();
  // }

  /**
   * Actualiza las tasas al iniciar el servidor (útil para desarrollo)
   */
  async onModuleInit() {
    this.logger.log('🚀 Actualizando tasas al iniciar el servidor...');
    try {
      const resultado = await this.monedaService.actualizarTodasLasTasas();
      this.logger.log(
        `✅ Tasas iniciales actualizadas: ${resultado.actualizadas} monedas`,
      );
    } catch (error) {
      this.logger.warn(
        `⚠️  No se pudieron actualizar las tasas al iniciar: ${error.message}`,
      );
    }
  }
}
