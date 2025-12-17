import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CuentaHistorial } from './interfaces/cuenta-historial.interface';
import { CreateCuentaHistorialDto } from './dto/create-cuenta-historial.dto';
import { generateUniqueId } from '../utils/generate-id';
import { HistorialRecurrente, HistorialRecurrenteDocument } from '../recurrentes/schemas/historial-recurrente.schema';

@Injectable()
export class CuentaHistorialService {
  constructor(
    @InjectModel('CuentaHistorial')
    private readonly historialModel: Model<CuentaHistorial>,
    @InjectModel('ConceptoPersonalizado')
    private readonly conceptoModel: Model<any>,
    @InjectModel(HistorialRecurrente.name)
    private readonly historialRecurrenteModel: Model<HistorialRecurrenteDocument>,
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

    // Obtener todos los movimientos manuales
    const data = await this.historialModel
      .find(filtro)
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

    // Obtener todos los recurrentes exitosos para la misma cuenta
    const recurrentes = await this.historialRecurrenteModel
      .find({ cuentaId, estado: 'exitoso' })
      .lean();

    const recurrentesFormateados = recurrentes.map((r) => ({
      ...r,
      _id: r._id,
      tipo: 'recurrente',
      descripcion: `Cargo recurrente: ${r.nombreRecurrente}`,
      monto: -(r.montoConvertido ?? r.monto),
      conceptoId: undefined,
      detalles: {
        origen: r.subcuentaId ? 'Desde subcuenta' : 'Movimiento directo',
        etiqueta: 'Recurrente',
        resumen: `${r.nombreRecurrente} - ${r.plataforma?.nombre || 'Sin plataforma'} (${r.montoConvertido ?? r.monto})`,
        plataforma: r.plataforma?.nombre,
        monedaOriginal: r.moneda,
        montoOriginal: r.monto,
        tasaConversion: r.tasaConversion,
      },
    }));

    // Unificar, ordenar y paginar
    const todosLosMovimientos = [...enriched, ...recurrentesFormateados].sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
    );

    const total = todosLosMovimientos.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginados = todosLosMovimientos.slice(start, end);

    return { total, page, limit, data: paginados };
  }

  async eliminar(id: string) {
    return await this.historialModel.findByIdAndDelete(id);
  }
}
