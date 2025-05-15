import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { Transaction, TransactionSchema } from './schemas/transaction.schema/transaction.schema';
import { SubcuentaHistorial, SubcuentaHistorialSchema } from '../subcuenta/schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { Cuenta, CuentaSchema } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaSchema } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: SubcuentaHistorial.name, schema: SubcuentaHistorialSchema },
      { name: Cuenta.name, schema: CuentaSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
    ]),
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}