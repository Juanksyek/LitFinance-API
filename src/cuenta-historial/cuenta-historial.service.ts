import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CuentaHistorial } from './interfaces/cuenta-historial.interface';
import { CreateCuentaHistorialDto } from './dto/create-cuenta-historial.dto';
import { generateUniqueId } from '../utils/generate-id';

@Injectable()
export class CuentaHistorialService {
  constructor(
    @InjectModel('CuentaHistorial')
    private readonly historialModel: Model<CuentaHistorial>,
    @InjectModel('ConceptoPersonalizado')
    private readonly conceptoModel: Model<any>,
  ) {}

  async registrarMovimiento(dto: CreateCuentaHistorialDto): Promise<CuentaHistorial> {
    const id = await generateUniqueId(this.historialModel);

    const nuevo = new this.historialModel({
      ...dto,
      id,
    });

    return await nuevo.save();
  }

  async buscarHistorial(cuentaId: string, page = 1, limit = 10, search?: string) {
    const filtro: any = { cuentaId };

    if (search) {
      const regex = new RegExp(search, 'i');
      filtro.$or = [
        { descripcion: regex },
        { tipo: regex },
        { conceptoId: regex },
        { subcuentaId: regex },
      ];
    }

    const total = await this.historialModel.countDocuments(filtro);
    const data = await this.historialModel
      .find(filtro)
      .sort({ fecha: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const conceptosMap = new Map<string, string>();
    const conceptoIds = data.map((item) => item.conceptoId).filter((id): id is string => !!id);

    if (conceptoIds.length) {
      const conceptos = await this.conceptoModel.find({ id: { $in: conceptoIds } }).lean();
      conceptos.forEach((c) => conceptosMap.set(c.id, c.nombre));
    }

    const enriched = data.map((item) => ({
        ...item,
        motivo: item.motivo ?? null,
        detalles: {
          origen: item.subcuentaId ? 'Desde subcuenta' : 'Movimiento directo',
          etiqueta: item.tipo === 'ajuste_subcuenta' ? 'Ajuste' : 'Manual',
          resumen: `${item.descripcion} (${item.monto})`,
          conceptoNombre: item.conceptoId ? conceptosMap.get(item.conceptoId) : undefined,
        },
    }));

    return { total, page, limit, data: enriched };
  }

  async eliminar(id: string) {
    return await this.historialModel.findByIdAndDelete(id);
  }
}