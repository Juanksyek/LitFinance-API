import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConceptoPersonalizado, ConceptoPersonalizadoDocument } from './schemas/concepto-personalizado.schema';
import { CreateConceptoDto } from './dto/create-concepto.dto';
import { UpdateConceptoDto } from './dto/update-concepto.dto';
import { generateUniqueId } from '../utils/generate-id';

@Injectable()
export class ConceptosService {
  constructor(
    @InjectModel(ConceptoPersonalizado.name)
    private conceptoModel: Model<ConceptoPersonalizadoDocument>,
  ) {}

  async crear(dto: CreateConceptoDto, userId: string) {
    const conceptoId = await generateUniqueId(this.conceptoModel, 'conceptoId');
  
    const nuevo = new this.conceptoModel({
      ...dto,
      userId,
      conceptoId,
    });
  
    const guardado = await nuevo.save();
    return guardado.toObject();
  }

  async listar(userId: string, page = 1, limit = 10, busqueda?: string) {
    const query: any = { userId };

    if (busqueda) {
      query.nombre = { $regex: busqueda, $options: 'i' };
    }

    const resultados = await this.conceptoModel
      .find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await this.conceptoModel.countDocuments(query);

    return {
      total,
      page,
      perPage: limit,
      resultados,
    };
  }

  async actualizar(conceptoId: string, userId: string, dto: UpdateConceptoDto) {
    const concepto = await this.conceptoModel.findOneAndUpdate(
      { conceptoId, userId },
      dto,
      { new: true },
    );
  
    if (!concepto) throw new NotFoundException('Concepto no encontrado');
    return concepto;
  }

  async eliminar(conceptoId: string, userId: string) {
    const eliminado = await this.conceptoModel.findOneAndDelete({ conceptoId, userId });
    if (!eliminado) throw new NotFoundException('No se encontró el concepto');
    return { message: 'Eliminado correctamente' };
  }
}
// Commit