import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketScan, TicketScanSchema } from './schemas/ticket-scan.schema';
import { TicketScanController } from './ticket-scan.controller';
import { TicketScanService } from './ticket-scan.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TicketScan.name, schema: TicketScanSchema },
    ]),
    forwardRef(() => TransactionsModule),
    forwardRef(() => UserModule),
  ],
  controllers: [TicketScanController],
  providers: [TicketScanService],
  exports: [TicketScanService],
})
export class TicketScanModule {}
