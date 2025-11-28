import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MoneyValidationService } from './validators/money-validation.service';
import { ConversionService } from './services/conversion.service';
import { Moneda, MonedaSchema } from '../moneda/schema/moneda.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Moneda.name, schema: MonedaSchema }]),
  ],
  providers: [MoneyValidationService, ConversionService],
  exports: [MoneyValidationService, ConversionService],
})
export class UtilsModule {}
