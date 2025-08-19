import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

import { User, UserSchema } from '../user/schemas/user.schema/user.schema';
import { Cuenta, CuentaSchema } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaSchema } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { Transaction, TransactionSchema } from '../transactions/schemas/transaction.schema/transaction.schema';
import { CuentaHistorial, CuentaHistorialSchema } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { ConceptoPersonalizado, ConceptoPersonalizadoSchema } from '../conceptos/schemas/concepto-personalizado.schema';

import { MonedaModule } from '../moneda/moneda.module';
import { UserModule } from '../user/user.module';
import { UtilsModule } from '../utils/utils.module';

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
    MonedaModule,
    UserModule,
    UtilsModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [
    AnalyticsService,
    MongooseModule,
  ],
})
export class AnalyticsModule {}
