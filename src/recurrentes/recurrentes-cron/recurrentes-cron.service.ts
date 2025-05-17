import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecurrentesService } from '../recurrentes.service';

@Injectable()
export class RecurrentesCronService {
  constructor(private readonly recurrentesService: RecurrentesService) {}

  // Cron diario a las 1:00 p.m.
  @Cron(CronExpression.EVERY_DAY_AT_1PM)
  async ejecutarRecordatorios() {
    console.log('Ejecutando cron diario de recordatorios...');
    await this.recurrentesService.verificarRecordatoriosDelDia();
  }
}