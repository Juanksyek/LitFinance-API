import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CuentaService } from './cuenta.service';
import { CuentaController } from './cuenta.controller';
import { Cuenta, CuentaSchema } from './schemas/cuenta.schema/cuenta.schema';
import { MonedaModule } from '../moneda/moneda.module';
import { CuentaHistorialModule } from '../cuenta-historial/cuenta-historial.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    MonedaModule,
    CuentaHistorialModule,
    forwardRef(() => UserModule), // Evitar dependencia circular
    MongooseModule.forFeature([
      { name: Cuenta.name, schema: CuentaSchema },
    ]),
  ],
  controllers: [CuentaController],
  providers: [CuentaService],
  exports: [
    CuentaService, 
    MongooseModule],
})
export class CuentaModule {}