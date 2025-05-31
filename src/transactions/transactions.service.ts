import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction, TransactionDocument } from './schemas/transaction.schema/transaction.schema';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { SubcuentaHistorial } from '../subcuenta/schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { Cuenta } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { generateUniqueId } from '../utils/generate-id';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(SubcuentaHistorial.name) private readonly historialModel: Model<any>,
    @InjectModel(Cuenta.name) private readonly cuentaModel: Model<any>,
    @InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<any>,
  ) {}

  async crear(dto: CreateTransactionDto, userId: string) {
    const transaccionId = await generateUniqueId(this.transactionModel, 'transaccionId');
  
    const nueva = new this.transactionModel({
      ...dto,
      userId,
      transaccionId,
    });
  
    const guardada = await nueva.save();
    await this.aplicarTransaccion(guardada);
  
    return guardada;
  }

  async editar(id: string, dto: UpdateTransactionDto, userId: string) {
    const actual = await this.transactionModel.findOne({ transaccionId: id });
    if (!actual) throw new NotFoundException('Transacción no encontrada');

    const actualizada = await this.transactionModel.findOneAndUpdate({ transaccionId: id }, dto, { new: true });
    if (!actualizada) throw new NotFoundException('No se pudo actualizar');

    const historialPayload: any = {
        userId: actualizada.userId,
        tipo: actualizada.tipo,
        descripcion: `Transacción de tipo ${actualizada.tipo} aplicada`,
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
    const now = new Date();
  
    if (rango) {
      let desde: Date | null;
      switch (rango) {
        case 'dia':
          desde = new Date(now.setHours(0, 0, 0, 0));
          break;
        case 'semana':
          desde = new Date(now.setDate(now.getDate() - 7));
          break;
        case 'mes':
          desde = new Date(now.setMonth(now.getMonth() - 1));
          break;
        case '3meses':
          desde = new Date(now.setMonth(now.getMonth() - 3));
          break;
        case '6meses':
          desde = new Date(now.setMonth(now.getMonth() - 6));
          break;
        case 'año':
          desde = new Date(now.setFullYear(now.getFullYear() - 1));
          break;
        default:
          desde = null;
      }
  
      if (desde) {
        query.createdAt = { $gte: desde };
      }
    }
  
    return this.transactionModel.find(query).sort({ createdAt: -1 });
  }

  async buscar(userId: string, filtros: { concepto?: string; motivo?: string; monto?: number }) {
    const query: any = { userId };

    if (filtros.concepto) {
      query.concepto = { $regex: filtros.concepto, $options: 'i' };
    }

    if (filtros.motivo) {
      query.motivo = { $regex: filtros.motivo, $options: 'i' };
    }

    if (filtros.monto !== undefined) {
      query.monto = filtros.monto;
    }

    return this.transactionModel.find(query).sort({ createdAt: -1 });
  }

  private async aplicarTransaccion(t: Transaction) {
    const factor = t.tipo === 'ingreso' ? 1 : -1;
    const montoAjustado = t.monto * factor;

    if (t.subCuentaId) {
      const subcuenta = await this.subcuentaModel.findOne({ subCuentaId: t.subCuentaId });
      if (!subcuenta) throw new NotFoundException('Subcuenta no encontrada');

      await this.subcuentaModel.updateOne({ subCuentaId: t.subCuentaId }, { $inc: { cantidad: montoAjustado } });

      if (t.afectaCuenta && subcuenta.cuentaId) {
        await this.cuentaModel.updateOne(
          { id: subcuenta.cuentaId, userId: t.userId },
          { $inc: { cantidad: montoAjustado } },
        );
      }
    } else if (t.cuentaId) {
      await this.cuentaModel.updateOne({ id: t.cuentaId, userId: t.userId }, { $inc: { cantidad: montoAjustado } });
    }

    await this.historialModel.create({
      subcuentaId: t.subCuentaId ?? null,
      userId: t.userId,
      tipo: t.tipo,
      descripcion: `Transacción de tipo ${t.tipo} aplicada`,
      datos: {
        concepto: t.concepto,
        monto: t.monto,
        afectaCuenta: t.afectaCuenta,
      },
    });
  }
}