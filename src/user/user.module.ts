import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User, UserSchema } from './schemas/user.schema/user.schema';
import { CleanupService } from './services/cleanup.service';
import { CurrencyConversionService } from './services/currency-conversion.service';
import { PremiumCronService } from './premium-cron.service';
import { SubscriptionVerifyCronService } from './subscription-verify-cron.service';
import { StripeModule } from '../stripe/stripe.module';
import { CuentaModule } from '../cuenta/cuenta.module';
import { SubcuentaModule } from 'src/subcuenta/subcuenta.module';
import { TransactionsModule } from 'src/transactions/transactions.module';
import { CuentaHistorialModule } from '../cuenta-historial/cuenta-historial.module';
import { MonedaModule } from '../moneda/moneda.module';
import { UtilsModule } from '../utils/utils.module';

import { Cuenta, CuentaSchema } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Transaction, TransactionSchema } from '../transactions/schemas/transaction.schema/transaction.schema';
import { CuentaHistorial, CuentaHistorialSchema } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { Moneda, MonedaSchema } from '../moneda/schema/moneda.schema';
import { Subcuenta, SubcuentaSchema } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { Recurrente, RecurrenteSchema } from '../recurrentes/schemas/recurrente.schema';
import { PlanAutoPauseService } from './services/plan-auto-pause.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Cuenta.name, schema: CuentaSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: CuentaHistorial.name, schema: CuentaHistorialSchema },
      { name: Moneda.name, schema: MonedaSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
      { name: Recurrente.name, schema: RecurrenteSchema },
    ]),
    forwardRef(() => CuentaModule),
    forwardRef(() => SubcuentaModule),
    TransactionsModule,
    CuentaHistorialModule,
    MonedaModule,
    StripeModule,
    UtilsModule
  ],
  controllers: [UserController],
  providers: [UserService, CleanupService, CurrencyConversionService, PremiumCronService, SubscriptionVerifyCronService, PlanAutoPauseService],
  exports: [UserService, MongooseModule, CurrencyConversionService, PlanAutoPauseService],
})
export class UserModule {}
