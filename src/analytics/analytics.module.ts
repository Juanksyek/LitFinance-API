import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

// Importar todos los schemas necesarios
import { User, UserSchema } from '../user/schemas/user.schema/user.schema';
import { Cuenta, CuentaSchema } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaSchema } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { Transaction, TransactionSchema } from '../transactions/schemas/transaction.schema/transaction.schema';
import { CuentaHistorial, CuentaHistorialSchema } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { ConceptoPersonalizado, ConceptoPersonalizadoSchema } from '../conceptos/schemas/concepto-personalizado.schema';

// Importar módulos y servicios necesarios
import { MonedaModule } from '../moneda/moneda.module';
import { MoneyValidationService } from '../utils/validators/money-validation.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Cuenta.name, schema: CuentaSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: CuentaHistorial.name, schema: CuentaHistorialSchema },
      { name: ConceptoPersonalizado.name, schema: ConceptoPersonalizadoSchema },
    ]),
    MonedaModule, // Para conversiones de moneda
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, MoneyValidationService],
  exports: [
    AnalyticsService,
    MongooseModule,
  ],
})
export class AnalyticsModule {}
