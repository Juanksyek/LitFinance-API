import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { SupportTicket, SupportTicketSchema } from './schemas/support-ticket.schema';
import { SupportTicketService } from './services/support-ticket.service';
import { SupportTicketController } from './controllers/support-ticket.controller';

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
  ],
  controllers: [
    SupportTicketController,
  ],
  providers: [
    SupportTicketService,
  ],
  exports: [
    SupportTicketService,
  ],
})
export class ReportsModule {}