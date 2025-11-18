import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserReport, UserReportSchema } from './schemas/user-report.schema';
import { WebReport, WebReportSchema } from './schemas/web-report.schema';
import { User, UserSchema } from '../user/schemas/user.schema/user.schema';

// Services
import { UserReportService } from './services/user-report.service';
import { WebReportService } from './services/web-report.service';

// Controllers
import { UserReportController } from './controllers/user-report.controller';
import { AdminReportController } from './controllers/admin-report.controller';
import { WebReportController } from './controllers/web-report.controller';

// Middleware
import { SecurityValidationMiddleware } from './middleware/security-validation.middleware';

@Module({
  imports: [
    // Configuración de throttling específica para reportes
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000, // 1 minuto
        limit: 5, // 5 requests por minuto
      },
      {
        name: 'medium',
        ttl: 300000, // 5 minutos
        limit: 15, // 15 requests por 5 minutos
      },
      {
        name: 'long',
        ttl: 3600000, // 1 hora
        limit: 50, // 50 requests por hora
      },
    ]),
    
    // Schemas de MongoDB
    MongooseModule.forFeature([
      { name: UserReport.name, schema: UserReportSchema },
      { name: WebReport.name, schema: WebReportSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [
    UserReportController,
    AdminReportController,
    WebReportController,
  ],
  providers: [
    UserReportService,
    WebReportService,
    SecurityValidationMiddleware,
  ],
  exports: [
    UserReportService,
    WebReportService,
  ],
})
export class ReportsModule {
  configure(consumer: MiddlewareConsumer) {
    // Aplicar middleware de seguridad a todas las rutas de reportes
    consumer
      .apply(SecurityValidationMiddleware)
      .forRoutes(
        { path: 'reports/*', method: RequestMethod.ALL }
      );
  }
}