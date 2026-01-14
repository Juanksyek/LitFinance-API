import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConceptoPersonalizado, ConceptoPersonalizadoDocument } from './schemas/concepto-personalizado.schema';
import { CreateConceptoDto } from './dto/create-concepto.dto';
import { UpdateConceptoDto } from './dto/update-concepto.dto';
import { generateUniqueId } from '../utils/generate-id';
import { CuentaHistorial } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { Transaction } from '../transactions/schemas/transaction.schema/transaction.schema';

@Injectable()
export class ConceptosService {
  constructor(
    @InjectModel(ConceptoPersonalizado.name)
    private conceptoModel: Model<ConceptoPersonalizadoDocument>,
    @InjectModel(CuentaHistorial.name)
    private cuentaHistorialModel: Model<any>,
    @InjectModel(Transaction.name)
    private transactionModel: Model<any>,
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
    // Verificar referencias en movimientos de cuenta
    const usadoEnHistorial = await this.cuentaHistorialModel.countDocuments({ conceptoId, cuentaId: { $exists: true }, userId });
    if (usadoEnHistorial > 0) {
      throw new BadRequestException('No se puede eliminar el concepto: está en uso en movimientos de cuenta');
    }

    // Verificar referencias en transacciones
    const usadoEnTransacciones = await this.transactionModel.countDocuments({ concepto: conceptoId, userId });
    if (usadoEnTransacciones > 0) {
      throw new BadRequestException('No se puede eliminar el concepto: está en uso en transacciones');
    }

    const eliminado = await this.conceptoModel.findOneAndDelete({ conceptoId, userId });
    if (!eliminado) throw new NotFoundException('No se encontró el concepto');
    return { message: 'Eliminado correctamente' };
  }
}
