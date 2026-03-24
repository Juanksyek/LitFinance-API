import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketScan, TicketScanSchema } from './schemas/ticket-scan.schema';
import { TicketScanController } from './ticket-scan.controller';
import { TicketScanService } from './ticket-scan.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { UserModule } from '../user/user.module';
import {
  OcrOrchestrator,
  OcrPipeline,
  StoreDetector,
  TicketClassifier,
  ItemExtractor,
  TotalsExtractor,
  DateExtractor,
  PaymentExtractor,
  CandidateRanker,
} from './ocr';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TicketScan.name, schema: TicketScanSchema },
    ]),
    forwardRef(() => TransactionsModule),
    forwardRef(() => UserModule),
  ],
  controllers: [TicketScanController],
  providers: [
    TicketScanService,
    OcrOrchestrator,
    OcrPipeline,
    StoreDetector,
    TicketClassifier,
    ItemExtractor,
    TotalsExtractor,
    DateExtractor,
    PaymentExtractor,
    CandidateRanker,
  ],
  exports: [TicketScanService],
})
export class TicketScanModule {}
