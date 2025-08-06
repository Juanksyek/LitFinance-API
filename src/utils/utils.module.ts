import { Module } from '@nestjs/common';
import { MoneyValidationService } from './validators/money-validation.service';

@Module({
  providers: [MoneyValidationService],
  exports: [MoneyValidationService],
})
export class UtilsModule {}
