import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { SupportTicket, SupportTicketSchema } from './schemas/support-ticket.schema';
import { SupportTicketService } from './services/support-ticket.service';
import { SupportTicketController } from './controllers/support-ticket.controller';
import { ReportExportController } from './controllers/report-export.controller';
import { ReportExportService } from './services/report-export.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { UserModule } from '../user/user.module';
import { PlanConfigModule } from '../plan-config/plan-config.module';
import { PlanActionGuard } from '../plan-config/guards/plan-action.guard';

@Module({
  imports: [
    // Configuración de throttling para el módulo de soporte
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000, // 1 minuto
        limit: 10, // 10 requests por minuto
      },
      {
        name: 'medium',
        ttl: 300000, // 5 minutos
        limit: 30, // 30 requests por 5 minutos
      },
    ]),
    
    // Schema de MongoDB
    MongooseModule.forFeature([
      { name: SupportTicket.name, schema: SupportTicketSchema },
    ]),

    // Dependencias para exportar reportes (analytics + premium guard)
    AnalyticsModule,
    UserModule,
    // Notificaciones: required to send push notifications on tickets
    NotificacionesModule,
    PlanConfigModule,
  ],
  controllers: [
    SupportTicketController,
    ReportExportController,
  ],
  providers: [
    SupportTicketService,
    ReportExportService,
    PlanActionGuard,
  ],
  exports: [
    SupportTicketService,
    ReportExportService,
  ],
})
export class ReportsModule {}