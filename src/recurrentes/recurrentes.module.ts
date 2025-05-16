import { Module } from '@nestjs/common';
import { RecurrentesService } from './recurrentes.service';
import { RecurrentesController } from './recurrentes.controller';

@Module({
  providers: [RecurrentesService],
  controllers: [RecurrentesController]
})
export class RecurrentesModule {}
