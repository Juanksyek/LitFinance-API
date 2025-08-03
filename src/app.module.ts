import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard, seconds } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { TransactionsModule } from './transactions/transactions.module';
import { GoalsModule } from './goals/goals.module';
import { CuentaModule } from './cuenta/cuenta.module';
import { SubcuentaModule } from './subcuenta/subcuenta.module';
import { MonedaModule } from './moneda/moneda.module';
import { RecurrentesModule } from './recurrentes/recurrentes.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';
import { ConceptosModule } from './conceptos/conceptos.module';
import { CuentaHistorialModule } from './cuenta-historial/cuenta-historial.module';
import { PlataformasRecurrentesModule } from './plataformas-recurrentes/plataformas-recurrentes.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGO_URI!),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: seconds(60),
          limit: 30,
        },
      ],
    }),
    UserModule,
    AuthModule,
    TransactionsModule,
    GoalsModule,
    CuentaModule,
    SubcuentaModule,
    MonedaModule,
    RecurrentesModule,
    NotificacionesModule,
    ConceptosModule,
    CuentaHistorialModule,
    PlataformasRecurrentesModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}