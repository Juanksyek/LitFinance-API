import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { TransactionsModule } from './transactions/transactions.module';
import { GoalsModule } from './goals/goals.module';
import { CuentaModule } from './cuenta/cuenta.module';
import { SubcuentaModule } from './subcuenta/subcuenta.module';
import { MonedaModule } from './moneda/moneda.module';
import { MonedaService } from './moneda/moneda.service';
import { MonedaController } from './moneda/moneda.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGO_URI!),
    UserModule,
    AuthModule,
    TransactionsModule,
    GoalsModule,
    CuentaModule,
    SubcuentaModule,
    MonedaModule,
  ],
  controllers: [AppController, MonedaController],
  providers: [AppService, MonedaService],
})
export class AppModule {}
