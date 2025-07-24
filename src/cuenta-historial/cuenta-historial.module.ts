import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CuentaHistorialController } from './cuenta-historial.controller';
import { CuentaHistorialService } from './cuenta-historial.service';
import { CuentaHistorial, CuentaHistorialSchema } from './schemas/cuenta-historial.schema';
import { ConceptosModule } from '../conceptos/conceptos.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: CuentaHistorial.name,
        schema: CuentaHistorialSchema,
      },
    ]),
    ConceptosModule,
  ],
  controllers: [CuentaHistorialController],
  providers: [CuentaHistorialService],
  exports: [
    CuentaHistorialService,
    MongooseModule,
  ],
})
export class CuentaHistorialModule {}