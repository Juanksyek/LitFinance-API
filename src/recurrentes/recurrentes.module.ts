import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecurrentesService } from './recurrentes.service';
import { RecurrentesController } from './recurrentes.controller';

import { Recurrente, RecurrenteSchema } from './schemas/recurrente.schema';
import { HistorialRecurrente, HistorialRecurrenteSchema } from './schemas/historial-recurrente.schema';
import { PlataformaRecurrente, PlataformaRecurrenteSchema } from '../plataformas-recurrentes/schemas/plataforma-recurrente.schema';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { RecurrentesCronService } from './recurrentes-cron/recurrentes-cron.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Recurrente.name, schema: RecurrenteSchema },
      { name: HistorialRecurrente.name, schema: HistorialRecurrenteSchema },
      { name: PlataformaRecurrente.name, schema: PlataformaRecurrenteSchema },
    ]),
    NotificacionesModule,
  ],
  controllers: [RecurrentesController],
  providers: [RecurrentesService, RecurrentesCronService],
  exports: [RecurrentesService],
})
export class RecurrentesModule {}
