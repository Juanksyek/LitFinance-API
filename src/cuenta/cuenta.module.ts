import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CuentaService } from './cuenta.service';
import { CuentaController } from './cuenta.controller';
import { Cuenta, CuentaSchema } from './schemas/cuenta.schema/cuenta.schema';
import { MonedaModule } from '../moneda/moneda.module';
import { CuentaHistorialModule } from '../cuenta-historial/cuenta-historial.module';

@Module({
  imports: [
    MonedaModule,
    CuentaHistorialModule,
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