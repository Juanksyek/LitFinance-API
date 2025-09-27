import { Module } from '@nestjs/common';
import { ConceptosService } from './conceptos.service';
import { ConceptosController } from './conceptos.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { ConceptoPersonalizado, ConceptoPersonalizadoSchema } from './schemas/concepto-personalizado.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ConceptoPersonalizado.name, schema: ConceptoPersonalizadoSchema },
    ]),
  ],
  controllers: [ConceptosController],
  providers: [ConceptosService],
  exports: [
    MongooseModule,
  ],
})
export class ConceptosModule {}
// commit