import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CreditCard, CreditCardSchema } from './schemas/credit-card.schema';
import { CreditCardService } from './credit-card.service';
import { CreditCardCronService } from './credit-card-cron.service';
import { CreditCardController } from './credit-card.controller';
import { UserModule } from '../user/user.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PlanConfigModule } from '../plan-config/plan-config.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CreditCard.name, schema: CreditCardSchema },
    ]),
    forwardRef(() => UserModule),
    PlanConfigModule,
    NotificacionesModule,
    TransactionsModule,
  ],
  controllers: [CreditCardController],
  providers: [CreditCardService, CreditCardCronService],
  exports: [CreditCardService, MongooseModule],
})
export class CreditCardModule {}
