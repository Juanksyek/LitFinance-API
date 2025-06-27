import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PlataformaRecurrente,
  PlataformaRecurrenteSchema,
} from './schemas/plataforma-recurrente.schema';
import { PlataformasRecurrentesService } from './plataformas-recurrentes.service';
import { PlataformasRecurrentesController } from './plataformas-recurrentes.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlataformaRecurrente.name, schema: PlataformaRecurrenteSchema },
    ]),
  ],
  controllers: [PlataformasRecurrentesController],
  providers: [PlataformasRecurrentesService],
  exports: [PlataformasRecurrentesService],
})
export class PlataformasRecurrentesModule {}
