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

  async findMovimientoById(id: string, userId: string): Promise<any | null> {
    return await this.historialModel.findOne({ id, userId }).lean();
  }

  /**
   * Crea o actualiza (idempotente) un movimiento de historial asociado a una transacción.
   * Se usa para mantener un solo registro por transacción (evitar duplicados) y habilitar distintivos.
   */
  async upsertMovimientoTransaccion(params: {
    transaccionId: string;
    movimiento: CreateCuentaHistorialDto;
    audit?: Record<string, any>;
  }): Promise<any> {
    const { transaccionId, movimiento, audit } = params;
    const id = await generateUniqueId(this.historialModel);

    const mergedMetadata = {
      ...(movimiento.metadata ?? {}),
      audit: {
        ...((movimiento.metadata ?? {}) as any)?.audit,
        ...(audit ?? {}),
        transaccionId,
        status: (audit as any)?.status ?? ((movimiento.metadata ?? {}) as any)?.audit?.status ?? 'active',
      },
    };

    return await this.historialModel.findOneAndUpdate(
      { cuentaId: movimiento.cuentaId, userId: movimiento.userId, 'metadata.audit.transaccionId': transaccionId },
      {
        $set: {
          ...movimiento,
          metadata: mergedMetadata,
        },
        $setOnInsert: { id },
      },
      { new: true, upsert: true },
    );
  }

  async marcarTransaccionEliminada(params: {
    cuentaId: string;
    userId: string;
    transaccionId: string;
    deletedAt?: Date;
    extra?: Record<string, any>;
    descripcion?: string;
  }): Promise<any> {
    const { cuentaId, userId, transaccionId, deletedAt, extra, descripcion } = params;
    const id = await generateUniqueId(this.historialModel);

    return await this.historialModel.findOneAndUpdate(
      { cuentaId, userId, 'metadata.audit.transaccionId': transaccionId },
      {
        $set: {
          ...(descripcion ? { descripcion } : {}),
          metadata: {
            audit: {
              transaccionId,
              status: 'deleted',
              deletedAt: (deletedAt ?? new Date()).toISOString(),
              ...(extra ?? {}),
            },
          },
        },
        $setOnInsert: {
          id,
          cuentaId,
          userId,
          monto: 0,
          tipo: 'ajuste_subcuenta',
          descripcion: descripcion ?? 'Transacción eliminada',
          fecha: (deletedAt ?? new Date()).toISOString(),
        },
      },
      { new: true, upsert: true },
    );
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

    // Evitar duplicados: los recurrentes exitosos ya se agregan desde historialRecurrente
    const enriched = data
      .filter((item) => item.tipo !== 'recurrente')
      .map((item) => {
      const audit = (item as any)?.metadata?.audit;
      const transaccionId = audit?.transaccionId ?? null;
      return {
      ...(item as any),
      ...item,
      motivo: item.motivo ?? null,
      transaccionId,
      detalles: {
        origen: item.subcuentaId ? 'Desde subcuenta' : 'Movimiento directo',
        etiqueta: item.tipo === 'ajuste_subcuenta' ? 'Ajuste' : 'Manual',
        resumen: `${item.descripcion} (${item.monto})`,
        conceptoNombre: item.conceptoId ? conceptosMap.get(item.conceptoId) : undefined,
        distintivo: (() => {
          const audit = (item as any)?.metadata?.audit;
          if (!audit) return null;

          if (audit.status === 'deleted') {
            return { tipo: 'deleted', label: 'Eliminado' };
          }

          if (audit.editedAt) {
            return { tipo: 'edited', label: 'Editado' };
          }

          if (audit.backdated) {
            return { tipo: 'backdated', label: 'Otra fecha' };
          }

          return null;
        })(),
      },
    };
    });

    // Obtener todos los recurrentes exitosos para la misma cuenta
    const recurrentes = await this.historialRecurrenteModel
      .find({ cuentaId, estado: 'exitoso' })
      .lean();

    const recurrentesFormateados = recurrentes.map((r) => ({
      ...r,
      _id: r._id,
      historialRecurrenteId: String(r._id),
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
