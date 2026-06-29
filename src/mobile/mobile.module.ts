import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CuentaHistorial, CuentaHistorialSchema } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { MonedaModule } from '../moneda/moneda.module';
import { RecurrentesModule } from '../recurrentes/recurrentes.module';
import { Recurrente, RecurrenteSchema } from '../recurrentes/schemas/recurrente.schema';
import { SubcuentaModule } from '../subcuenta/subcuenta.module';
import { Subcuenta, SubcuentaSchema } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { TransactionsModule } from '../transactions/transactions.module';
import { Transaction, TransactionSchema } from '../transactions/schemas/transaction.schema/transaction.schema';
import { User, UserSchema } from '../user/schemas/user.schema/user.schema';
import { UserModule } from '../user/user.module';
import { MobileController } from './mobile.controller';
import { MobilePushService } from './mobile-push.service';
import { MobileRateLimitService } from './mobile-rate-limit.service';
import { MobileService } from './mobile.service';
import {
  MobileSyncOperation,
  MobileSyncOperationSchema,
} from './schemas/mobile-sync-operation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
      { name: Recurrente.name, schema: RecurrenteSchema },
      { name: CuentaHistorial.name, schema: CuentaHistorialSchema },
      { name: MobileSyncOperation.name, schema: MobileSyncOperationSchema },
    ]),
    UserModule,
    MonedaModule,
    TransactionsModule,
    SubcuentaModule,
    RecurrentesModule,
  ],
  controllers: [MobileController],
  providers: [MobileService, MobilePushService, MobileRateLimitService],
})
export class MobileModule {}
