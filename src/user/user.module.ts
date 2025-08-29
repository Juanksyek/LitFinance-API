import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User, UserSchema } from './schemas/user.schema/user.schema';
import { CleanupService } from './services/cleanup.service';
import { CurrencyConversionService } from './services/currency-conversion.service';
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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Cuenta.name, schema: CuentaSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: CuentaHistorial.name, schema: CuentaHistorialSchema },
      { name: Moneda.name, schema: MonedaSchema }
    ]),
    forwardRef(() => CuentaModule),
    SubcuentaModule,
    TransactionsModule,
    CuentaHistorialModule,
    MonedaModule,
    UtilsModule
  ],
  controllers: [UserController],
  providers: [UserService, CleanupService, CurrencyConversionService],
  exports: [MongooseModule, CurrencyConversionService],
})
export class UserModule {}
