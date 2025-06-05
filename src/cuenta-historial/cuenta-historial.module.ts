import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CuentaHistorialController } from './cuenta-historial.controller';
import { CuentaHistorialService } from './cuenta-historial.service';
import { CuentaHistorialSchema } from './schemas/cuenta-historial.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: 'CuentaHistorial',
        schema: CuentaHistorialSchema,
      },
    ]),
  ],
  controllers: [CuentaHistorialController],
  providers: [CuentaHistorialService],
  exports: [CuentaHistorialService],
})
export class CuentaHistorialModule { }
