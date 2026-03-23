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
import { Meta, MetaSchema } from '../goals/schemas/meta.schema';
import { PlanConfigModule } from '../plan-config/plan-config.module';
import { CuentaHistorialModule } from '../cuenta-historial/cuenta-historial.module';
import { AuthModule } from '../auth/auth.module';
import { SharedSpaceMember, SharedSpaceMemberSchema } from '../shared/schemas/shared-space-member.schema';
import { SharedSpace, SharedSpaceSchema } from '../shared/schemas/shared-space.schema';
import { SharedInvitation, SharedInvitationSchema } from '../shared/schemas/shared-invitation.schema';
import { SharedNotification, SharedNotificationSchema } from '../shared/schemas/shared-notification.schema';
import { SharedMovement, SharedMovementSchema } from '../shared/schemas/shared-movement.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Cuenta.name, schema: CuentaSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
      { name: Meta.name, schema: MetaSchema },
      { name: Recurrente.name, schema: RecurrenteSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: SharedSpaceMember.name, schema: SharedSpaceMemberSchema },
      { name: SharedSpace.name, schema: SharedSpaceSchema },
      { name: SharedInvitation.name, schema: SharedInvitationSchema },
      { name: SharedNotification.name, schema: SharedNotificationSchema },
      { name: SharedMovement.name, schema: SharedMovementSchema },
    ]),
    PlanConfigModule,
    CuentaHistorialModule,
    AuthModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRateLimitService],
})
export class DashboardModule {}
