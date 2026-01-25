import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardRateLimitService } from './dashboard-rate-limit.service';
import { User, UserSchema } from '../user/schemas/user.schema/user.schema';
import { Cuenta, CuentaSchema } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaSchema } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { Recurrente, RecurrenteSchema } from '../recurrentes/schemas/recurrente.schema';
import { Transaction, TransactionSchema } from '../transactions/schemas/transaction.schema/transaction.schema';
import { PlanConfigModule } from '../plan-config/plan-config.module';
import { CuentaHistorialModule } from '../cuenta-historial/cuenta-historial.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Cuenta.name, schema: CuentaSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
      { name: Recurrente.name, schema: RecurrenteSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    PlanConfigModule,
    CuentaHistorialModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRateLimitService],
})
export class DashboardModule {}
