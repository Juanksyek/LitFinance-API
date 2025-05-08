import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MonedaController } from './moneda.controller';
import { MonedaService } from './moneda.service';
import { Moneda, MonedaSchema } from './schema/moneda.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Moneda.name, schema: MonedaSchema }]),
  ],
  controllers: [MonedaController],
  providers: [MonedaService],
  exports: [MonedaService],
})
export class MonedaModule {}