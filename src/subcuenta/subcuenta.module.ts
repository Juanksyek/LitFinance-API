import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubcuentaService } from './subcuenta.service';
import { SubcuentaController } from './subcuenta.controller';
import { SubcuentaHistorial, SubcuentaHistorialSchema } from './schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { Subcuenta, SubcuentaSchema } from './schemas/subcuenta.schema/subcuenta.schema';
import { Cuenta, CuentaSchema } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { CuentaModule } from '../cuenta/cuenta.module';
import { MonedaModule } from '../moneda/moneda.module';
import { CuentaHistorialModule } from '../cuenta-historial/cuenta-historial.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SubcuentaHistorial.name, schema: SubcuentaHistorialSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
      { name: Cuenta.name, schema: CuentaSchema },
    ]),
    CuentaModule,
    MonedaModule,
    CuentaHistorialModule,
  ],
  controllers: [SubcuentaController],
  providers: [SubcuentaService],
  exports: [MongooseModule],
})
export class SubcuentaModule {}