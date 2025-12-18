import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecurrentesService } from './recurrentes.service';
import { RecurrentesTestService } from './recurrentes-test.service';
import { RecurrentesController } from './recurrentes.controller';

import { Recurrente, RecurrenteSchema } from './schemas/recurrente.schema';
import { HistorialRecurrente, HistorialRecurrenteSchema } from './schemas/historial-recurrente.schema';
import { PlataformaRecurrente, PlataformaRecurrenteSchema } from '../plataformas-recurrentes/schemas/plataforma-recurrente.schema';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { RecurrentesCronService } from './recurrentes-cron/recurrentes-cron.service';
import { CuentaModule } from 'src/cuenta/cuenta.module';
import { Cuenta, CuentaSchema } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaSchema } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { MonedaModule } from 'src/moneda/moneda.module';
import { CuentaHistorialModule } from 'src/cuenta-historial/cuenta-historial.module';
import { UtilsModule } from 'src/utils/utils.module';
import { UserModule } from 'src/user/user.module';
import { SubcuentaModule } from 'src/subcuenta/subcuenta.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Recurrente.name, schema: RecurrenteSchema },
      { name: HistorialRecurrente.name, schema: HistorialRecurrenteSchema },
      { name: PlataformaRecurrente.name, schema: PlataformaRecurrenteSchema },
      { name: Cuenta.name, schema: CuentaSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
    ]),
    NotificacionesModule,
    CuentaModule,
    SubcuentaModule,
    MonedaModule,
    CuentaHistorialModule,
    UtilsModule,
    forwardRef(() => UserModule),
  ],
  controllers: [RecurrentesController],
  providers: [RecurrentesService, RecurrentesCronService, RecurrentesTestService],
  exports: [RecurrentesService],
})
export class RecurrentesModule {}
