import { Module } from '@nestjs/common';
import { ConceptosService } from './conceptos.service';
import { ConceptosController } from './conceptos.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { ConceptoPersonalizado, ConceptoPersonalizadoSchema } from './schemas/concepto-personalizado.schema';
import { CuentaHistorial, CuentaHistorialSchema } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { Transaction, TransactionSchema } from '../transactions/schemas/transaction.schema/transaction.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ConceptoPersonalizado.name, schema: ConceptoPersonalizadoSchema },
      { name: CuentaHistorial.name, schema: CuentaHistorialSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
  ],
  controllers: [ConceptosController],
  providers: [ConceptosService],
  exports: [
    MongooseModule,
  ],
})
export class ConceptosModule {}
