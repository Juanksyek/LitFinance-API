import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction, TransactionDocument } from './schemas/transaction.schema/transaction.schema';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { SubcuentaHistorial } from '../subcuenta/schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { Cuenta } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';
import { generateUniqueId } from '../utils/generate-id';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(SubcuentaHistorial.name) private readonly historialModel: Model<any>,
    @InjectModel(Cuenta.name) private readonly cuentaModel: Model<any>,
    @InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<any>,
    private readonly historialService: CuentaHistorialService
  ) {}

  async crear(dto: CreateTransactionDto, userId: string) {
    const transaccionId = await generateUniqueId(this.transactionModel, 'transaccionId');
  
    const nueva = new this.transactionModel({
      ...dto,
      userId,
      transaccionId,
    });
  
    const guardada = await nueva.save();
    const result = await this.aplicarTransaccion(guardada);

    if (dto.afectaCuenta && dto.cuentaId) {
      await this.historialService.registrarMovimiento({
        userId: dto.userId ?? userId,
        cuentaId: dto.cuentaId,
        monto: dto.monto,
        tipo: dto.tipo,
        descripcion: `Transacción manual de tipo ${dto.tipo}`,
        fecha: new Date().toISOString(),
        conceptoId: dto.concepto,
      });
    }
  
    return {
      transaccion: guardada,
      subcuenta: result?.subcuenta ?? null,
      historial: result?.historial ?? null,
    };
  }

  async editar(id: string, dto: UpdateTransactionDto, userId: string) {
    const actual = await this.transactionModel.findOne({ transaccionId: id });
    if (!actual) throw new NotFoundException('Transacción no encontrada');
  
    const actualizada = await this.transactionModel.findOneAndUpdate(
      { transaccionId: id },
      dto,
      { new: true }
    );
    if (!actualizada) throw new NotFoundException('No se pudo actualizar');
  
    const historialPayload: any = {
      userId: actualizada.userId,
      tipo: actualizada.tipo,
      descripcion: `Transacción de tipo ${actualizada.tipo} actualizada`,
      datos: {
        concepto: actualizada.concepto,
        monto: actualizada.monto,
        afectaCuenta: actualizada.afectaCuenta,
      },
    };
  
    if (actualizada.subCuentaId) {
      historialPayload.subcuentaId = actualizada.subCuentaId;
    }
  
    await this.historialModel.create(historialPayload);
  
    if (actualizada.afectaCuenta && actualizada.cuentaId) {
      await this.historialService.registrarMovimiento({
        userId: dto.userId ?? userId,
        cuentaId: actualizada.cuentaId,
        monto: actualizada.monto,
        tipo: actualizada.tipo,
        descripcion: `Edición de transacción tipo ${actualizada.tipo}`,
        fecha: new Date().toISOString(),
        conceptoId: actualizada.concepto,
      });
    }
  
    return actualizada;
  }

  async eliminar(id: string, userId: string) {
    const transaccion = await this.transactionModel.findOneAndDelete({ transaccionId: id });
    if (!transaccion) throw new NotFoundException('Transacción no encontrada');

    await this.historialModel.create({
      subcuentaId: transaccion.subCuentaId ?? null,
      userId: transaccion.userId,
      tipo: 'eliminacion',
      descripcion: 'Transacción eliminada',
      datos: { concepto: transaccion.concepto, monto: transaccion.monto },
    });

    return { message: 'Transacción eliminada correctamente' };
  }

  async listar(userId: string, rango?: string) {
    const query: any = { userId };
  
    if (rango) {
      const now = new Date();
      let desde: Date | null = null;
      let hasta: Date | null = null;
  
      switch (rango) {
        case 'dia':
          desde = new Date(now);
          desde.setHours(0, 0, 0, 0);
          hasta = new Date(now);
          hasta.setHours(23, 59, 59, 999);
          break;
  
        case 'semana':
          desde = new Date(now);
          desde.setDate(now.getDate() - 7);
          break;
  
        case 'mes':
          desde = new Date(now);
          desde.setMonth(now.getMonth() - 1);
          break;
  
        case '3meses':
          desde = new Date(now);
          desde.setMonth(now.getMonth() - 3);
          break;
  
        case '6meses':
          desde = new Date(now);
          desde.setMonth(now.getMonth() - 6);
          break;
  
        case 'año':
          desde = new Date(now);
          desde.setFullYear(now.getFullYear() - 1);
          break;
  
        default:
          break;
      }
  
      if (desde && hasta) {
        query.createdAt = { $gte: desde, $lte: hasta };
      } else if (desde) {
        query.createdAt = { $gte: desde };
      }
    }
  
    return this.transactionModel.find(query).sort({ createdAt: -1 });
  }

  async obtenerHistorial({ subCuentaId, desde, hasta, limite, pagina, descripcion }) {
    const filtros: any = { subcuentaId: subCuentaId };
  
    if (descripcion) {
      filtros.descripcion = { $regex: descripcion, $options: 'i' };
    }
  
    if (desde || hasta) {
      filtros.createdAt = {};
      if (desde) filtros.createdAt.$gte = new Date(desde);
      if (hasta) filtros.createdAt.$lte = new Date(hasta);
    }
  
    const [resultados, total] = await Promise.all([
      this.historialModel.find(filtros)
        .sort({ createdAt: -1 })
        .skip((pagina - 1) * limite)
        .limit(limite),
      this.historialModel.countDocuments(filtros),
    ]);
  
    return {
      resultados,
      totalPaginas: Math.ceil(total / limite),
    };
  }

  private async aplicarTransaccion(t: Transaction) {
    const factor = t.tipo === 'ingreso' ? 1 : -1;
    const montoAjustado = t.monto * factor;
  
    if (t.subCuentaId) {
      const subcuenta = await this.subcuentaModel.findOne({ subCuentaId: t.subCuentaId });
  
      if (!subcuenta) {
        throw new NotFoundException('Subcuenta no encontrada');
      }
  
      const updateResult = await this.subcuentaModel.updateOne(
        { subCuentaId: t.subCuentaId },
        { $inc: { cantidad: montoAjustado } }
      );
    
      if (t.afectaCuenta && subcuenta.cuentaId) {
        await this.cuentaModel.updateOne(
          { id: subcuenta.cuentaId, userId: t.userId },
          { $inc: { cantidad: montoAjustado } }
        );
      }
  
      const historial = await this.historialModel.create({
        subcuentaId: t.subCuentaId,
        userId: t.userId,
        tipo: t.tipo,
        descripcion: `Transacción de tipo ${t.tipo} aplicada`,
        datos: {
          concepto: t.concepto,
          monto: t.monto,
          afectaCuenta: t.afectaCuenta,
        },
      });
  
      const subcuentaActualizada = await this.subcuentaModel.findOne({ subCuentaId: t.subCuentaId }).lean();
      return { subcuenta: subcuentaActualizada, historial };
    }
  
    return null;
  }
}