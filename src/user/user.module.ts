import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User, UserSchema } from './schemas/user.schema/user.schema';
import { CleanupService } from './services/cleanup.service';
import { CuentaModule } from '../cuenta/cuenta.module';
import { SubcuentaModule } from 'src/subcuenta/subcuenta.module';
import { TransactionsModule } from 'src/transactions/transactions.module';
import { CuentaHistorialModule } from '../cuenta-historial/cuenta-historial.module';
import { MonedaModule } from '../moneda/moneda.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    CuentaModule,
    SubcuentaModule,
    TransactionsModule,
    CuentaHistorialModule,
    MonedaModule
  ],
  controllers: [UserController],
  providers: [UserService, CleanupService],
  exports: [MongooseModule],
})
export class UserModule {}
