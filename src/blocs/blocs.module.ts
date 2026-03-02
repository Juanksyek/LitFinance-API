import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BlocsController } from './blocs.controller';
import { BlocsService } from './blocs.service';
import { Bloc, BlocSchema } from './schemas/bloc.schema';
import { BlocItem, BlocItemSchema } from './schemas/bloc-item.schema';
import { BlocLiquidation, BlocLiquidationSchema } from './schemas/bloc-liquidation.schema';
import { TransactionsModule } from '../transactions/transactions.module';
import { Cuenta, CuentaSchema } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaSchema } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { MonedaModule } from '../moneda/moneda.module';
import { ExchangeRateService } from './services/exchange-rate.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Bloc.name, schema: BlocSchema },
      { name: BlocItem.name, schema: BlocItemSchema },
      { name: BlocLiquidation.name, schema: BlocLiquidationSchema },
      { name: Cuenta.name, schema: CuentaSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
    ]),
    MonedaModule,
    forwardRef(() => TransactionsModule),
  ],
  controllers: [BlocsController],
  providers: [BlocsService, ExchangeRateService],
  exports: [BlocsService, MongooseModule],
})
export class BlocsModule {}
