import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

import { Meta, MetaSchema } from './schemas/meta.schema';
import { MetaEvento, MetaEventoSchema } from './schemas/meta-evento.schema';
import { InternalTransfer, InternalTransferSchema } from './schemas/internal-transfer.schema';
import { InternalTransferService } from './services/internal-transfer.service';

import { SubcuentaModule } from '../subcuenta/subcuenta.module';
import { CuentaModule } from '../cuenta/cuenta.module';
import { CuentaHistorialModule } from '../cuenta-historial/cuenta-historial.module';
import { UserModule } from '../user/user.module';
import { UtilsModule } from '../utils/utils.module';

import { Cuenta, CuentaSchema } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaSchema } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { CuentaHistorial, CuentaHistorialSchema } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { SubcuentaHistorial, SubcuentaHistorialSchema } from '../subcuenta/schemas/subcuenta-historial.schema/subcuenta-historial.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Meta.name, schema: MetaSchema },
      { name: MetaEvento.name, schema: MetaEventoSchema },
      { name: InternalTransfer.name, schema: InternalTransferSchema },
      { name: Cuenta.name, schema: CuentaSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
      { name: CuentaHistorial.name, schema: CuentaHistorialSchema },
      { name: SubcuentaHistorial.name, schema: SubcuentaHistorialSchema },
    ]),
    CuentaModule,
    SubcuentaModule,
    CuentaHistorialModule,
    UserModule,
    UtilsModule,
  ],
  controllers: [GoalsController],
  providers: [GoalsService, InternalTransferService],
})
export class GoalsModule {}
