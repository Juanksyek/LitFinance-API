import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketScan, TicketScanSchema } from './schemas/ticket-scan.schema';
import { TicketScanController } from './ticket-scan.controller';
import { TicketScanService } from './ticket-scan.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { UserModule } from '../user/user.module';
import { CuentaHistorialModule } from '../cuenta-historial/cuenta-historial.module';
import {
  OcrOrchestrator,
  OcrPipeline,
  ImagePreprocessor,
  StoreDetector,
  TicketClassifier,
  ItemExtractor,
  TotalsExtractor,
  DateExtractor,
  PaymentExtractor,
  CandidateRanker,
  ReconciliationService,
  EvaluationService,
} from './ocr';
import { AzureOcrProvider } from './ocr/providers/azure.provider';
import { OcrSpaceProvider } from './ocr/providers/ocrspace.provider';
import { PythonOcrWorkerProvider } from './ocr/providers/python-worker.provider';
import { SupermarketExtractor } from './ocr/extractors/supermarket.extractor';
import { RestaurantExtractor } from './ocr/extractors/restaurant.extractor';
import { GenericExtractor } from './ocr/extractors/generic.extractor';
import { TicketTemplate, TicketTemplateSchema } from './learning/ticket-template.schema';
import { TicketLearningService } from './learning/ticket-learning.service';
import { StructureAnalyzer } from './learning/structure-analyzer';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TicketScan.name, schema: TicketScanSchema },
      { name: TicketTemplate.name, schema: TicketTemplateSchema },
    ]),
    forwardRef(() => TransactionsModule),
    forwardRef(() => UserModule),
    CuentaHistorialModule,
  ],
  controllers: [TicketScanController],
  providers: [
    TicketScanService,
    ImagePreprocessor,
    OcrOrchestrator,
    OcrPipeline,
    AzureOcrProvider,
    OcrSpaceProvider,
    PythonOcrWorkerProvider,
    StoreDetector,
    TicketClassifier,
    ItemExtractor,
    TotalsExtractor,
    DateExtractor,
    PaymentExtractor,
    CandidateRanker,
    ReconciliationService,
    EvaluationService,
    SupermarketExtractor,
    RestaurantExtractor,
    GenericExtractor,
    StructureAnalyzer,
    TicketLearningService,
  ],
  exports: [TicketScanService, TicketLearningService],
})
export class TicketScanModule {}
