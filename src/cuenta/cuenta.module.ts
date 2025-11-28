import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CuentaService } from './cuenta.service';
import { CuentaController } from './cuenta.controller';
import { Cuenta, CuentaSchema } from './schemas/cuenta.schema/cuenta.schema';
import { User, UserSchema } from '../user/schemas/user.schema/user.schema';
import { Subcuenta, SubcuentaSchema } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { MonedaModule } from '../moneda/moneda.module';
import { CuentaHistorialModule } from '../cuenta-historial/cuenta-historial.module';
import { UserModule } from '../user/user.module';
import { UtilsModule } from '../utils/utils.module';

@Module({
  imports: [
    MonedaModule,
    CuentaHistorialModule,
    UtilsModule,
    forwardRef(() => UserModule),
    MongooseModule.forFeature([
      { name: Cuenta.name, schema: CuentaSchema },
      { name: User.name, schema: UserSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
    ]),
  ],
  controllers: [CuentaController],
  providers: [CuentaService],
  exports: [
    CuentaService, 
    MongooseModule],
})
export class CuentaModule {}