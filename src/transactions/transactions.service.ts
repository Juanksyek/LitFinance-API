import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
import { ConversionService } from '../utils/services/conversion.service';
import { UserService } from '../user/user.service';
import { DashboardVersionService } from '../user/services/dashboard-version.service';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(SubcuentaHistorial.name) private readonly historialModel: Model<any>,
    @InjectModel(Cuenta.name) private readonly cuentaModel: Model<any>,
    @InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<any>,
    private readonly historialService: CuentaHistorialService,
    private readonly conversionService: ConversionService,
    private readonly userService: UserService,
    private readonly dashboardVersionService: DashboardVersionService,
  ) {}

  private parseDateInput(value: string, isEnd: boolean): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(isEnd ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
    }
    return new Date(value);
  }

  private sameUtcYmd(a: Date, b: Date): boolean {
    return (
      a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate()
    );
  }

  async crear(dto: CreateTransactionDto, userId: string) {
    const transaccionId = await generateUniqueId(this.transactionModel, 'transaccionId');
    const registradoEn = new Date();
    const fechaEfectiva = dto.fecha ? this.parseDateInput(dto.fecha, false) : registradoEn;
    const backdated = !this.sameUtcYmd(fechaEfectiva, registradoEn);
  
    // Obtener monedaPrincipal del usuario
    const user = await this.userService.getProfile(userId);
    const monedaPrincipal = user.monedaPrincipal || 'MXN';

    // Si la transacción pertenece a una subcuenta y no trae moneda, usar la moneda de la subcuenta
    let subcuentaRef: any = null;
    if (dto.subCuentaId) {
      subcuentaRef = await this.subcuentaModel.findOne({ subCuentaId: dto.subCuentaId, userId });
      if (!subcuentaRef) throw new NotFoundException('Subcuenta no encontrada');
    }

    const monedaTransaccion = dto.moneda || subcuentaRef?.moneda || monedaPrincipal;

    // Resolver cuenta destino para efectos de balance cuando afectaCuenta=true
    const cuentaIdEfectiva = dto.cuentaId || subcuentaRef?.cuentaId;

    // Determinar moneda destino para montoConvertido (si afecta cuenta: moneda de la cuenta; si no: monedaPrincipal)
    let monedaDestinoConversion = monedaPrincipal;
    if (dto.afectaCuenta) {
      const cuentaIdDestino = dto.cuentaId || subcuentaRef?.cuentaId;
      if (cuentaIdDestino) {
        const cuenta = await this.cuentaModel.findOne({ id: cuentaIdDestino, userId });
        if (cuenta?.moneda) monedaDestinoConversion = cuenta.moneda;
      }
    }
  
    const payload: any = {
      ...dto,
      userId,
      transaccionId,
      moneda: monedaTransaccion,
      cuentaId: cuentaIdEfectiva,
      fecha: fechaEfectiva,
      registradoEn,
    };

    // Si la moneda de la transacción difiere de la moneda destino, convertir
    if (monedaTransaccion !== monedaDestinoConversion) {
      const conversion = await this.conversionService.convertir(
        dto.monto,
        monedaTransaccion,
        monedaDestinoConversion,
      );
      payload.montoConvertido = conversion.montoConvertido;
      payload.monedaConvertida = monedaDestinoConversion;
      payload.tasaConversion = conversion.tasaConversion;
      payload.fechaConversion = conversion.fechaConversion;
    } else {
      payload.monedaConvertida = monedaDestinoConversion;
    }

    const nueva = new this.transactionModel(payload);
    const guardada = await nueva.save();

    const txObj = {
      ...guardada.toObject(),
      motivo: dto.motivo,
      concepto: dto.concepto,
    };

    const balanceResult = await this.aplicarBalances(txObj, 1);

    if (balanceResult?.cuentaId) {
      await this.historialService.upsertMovimientoTransaccion({
        transaccionId,
        movimiento: {
          userId,
          cuentaId: balanceResult.cuentaId,
          monto: balanceResult.cuentaDelta ?? 0,
          tipo: txObj.tipo,
          descripcion: `Transacción de tipo ${txObj.tipo} aplicada`,
          fecha: fechaEfectiva.toISOString(),
          subcuentaId: txObj.subCuentaId,
          motivo: txObj.motivo,
          conceptoId: txObj.concepto,
          metadata: {
            ...balanceResult.metadata,
          },
        },
        audit: {
          source: 'transaction',
          action: 'create',
          status: 'active',
          backdated,
          registradoEn: registradoEn.toISOString(),
          fechaEfectiva: fechaEfectiva.toISOString(),
        },
      });
    }

    await this.dashboardVersionService.touchDashboard(userId, 'transaction.create');
  
    return {
      transaccion: guardada,
      subcuenta: balanceResult?.subcuenta ?? null,
      historial: balanceResult?.historial ?? null,
      meta: {
        backdated,
        fechaEfectiva: fechaEfectiva.toISOString(),
        registradoEn: registradoEn.toISOString(),
      },
    };
  }

  async editar(id: string, dto: UpdateTransactionDto, userId: string) {
    const actual = await this.transactionModel.findOne({ transaccionId: id, userId });
    if (!actual) throw new NotFoundException('Transacción no encontrada');

    const actualObj: any = actual.toObject();
    const revertResult = await this.aplicarBalances(actualObj, -1);

    // Obtener monedaPrincipal del usuario (para resolver defaults)
    const user = await this.userService.getProfile(userId);
    const monedaPrincipal = user.monedaPrincipal || 'MXN';

    let subcuentaRef: any = null;
    const nextSubCuentaId = dto.subCuentaId ?? actualObj.subCuentaId;
    if (nextSubCuentaId) {
      subcuentaRef = await this.subcuentaModel.findOne({ subCuentaId: nextSubCuentaId, userId });
      if (!subcuentaRef) throw new NotFoundException('Subcuenta no encontrada');
    }

    const nextAfectaCuenta = dto.afectaCuenta ?? actualObj.afectaCuenta;
    const monedaTransaccion = dto.moneda || subcuentaRef?.moneda || actualObj.moneda || monedaPrincipal;
    const cuentaIdEfectiva = dto.cuentaId || actualObj.cuentaId || subcuentaRef?.cuentaId;

    const registradoEn = actualObj.registradoEn ? new Date(actualObj.registradoEn) : new Date(actualObj.createdAt ?? Date.now());
    const fechaEfectiva = dto.fecha ? this.parseDateInput(dto.fecha, false) : (actualObj.fecha ? new Date(actualObj.fecha) : new Date(actualObj.createdAt ?? Date.now()));
    const backdated = !this.sameUtcYmd(fechaEfectiva, registradoEn);

    const updatePayload: any = {
      ...dto,
      moneda: monedaTransaccion,
      cuentaId: cuentaIdEfectiva,
      subCuentaId: nextSubCuentaId,
      afectaCuenta: nextAfectaCuenta,
      fecha: fechaEfectiva,
      registradoEn,
    };

    // limpiar undefined para no pisar campos
    Object.keys(updatePayload).forEach((k) => updatePayload[k] === undefined && delete updatePayload[k]);

    const actualizada = await this.transactionModel.findOneAndUpdate(
      { transaccionId: id, userId },
      { $set: updatePayload },
      { new: true },
    );
    if (!actualizada) throw new NotFoundException('No se pudo actualizar');

    const txObj = { ...actualizada.toObject(), concepto: actualizada.concepto, motivo: actualizada.motivo };
    const applyResult = await this.aplicarBalances(txObj, 1);

    // Historial subcuenta (auditoría simple)
    await this.historialModel.create({
      subcuentaId: txObj.subCuentaId ?? null,
      userId: txObj.userId,
      tipo: 'edicion',
      descripcion: 'Transacción editada',
      datos: {
        transaccionId: id,
        antes: {
          tipo: actualObj.tipo,
          monto: actualObj.monto,
          concepto: actualObj.concepto,
          fecha: actualObj.fecha ?? actualObj.createdAt,
        },
        despues: {
          tipo: txObj.tipo,
          monto: txObj.monto,
          concepto: txObj.concepto,
          fecha: txObj.fecha ?? (txObj as any).createdAt,
        },
      },
    });

    const cuentaIdHist = applyResult?.cuentaId ?? revertResult?.cuentaId;
    if (cuentaIdHist) {
      await this.historialService.upsertMovimientoTransaccion({
        transaccionId: id,
        movimiento: {
          userId,
          cuentaId: cuentaIdHist,
          monto: applyResult?.cuentaDelta ?? 0,
          tipo: txObj.tipo,
          descripcion: `Transacción de tipo ${txObj.tipo} aplicada`,
          fecha: fechaEfectiva.toISOString(),
          subcuentaId: txObj.subCuentaId,
          motivo: txObj.motivo,
          conceptoId: txObj.concepto,
          metadata: {
            ...(applyResult?.metadata ?? {}),
          },
        },
        audit: {
          source: 'transaction',
          action: 'edit',
          status: 'active',
          backdated,
          editedAt: new Date().toISOString(),
          registradoEn: registradoEn.toISOString(),
          fechaEfectiva: fechaEfectiva.toISOString(),
          previous: {
            tipo: actualObj.tipo,
            monto: actualObj.monto,
            concepto: actualObj.concepto,
            fecha: (actualObj.fecha ?? actualObj.createdAt) ? new Date(actualObj.fecha ?? actualObj.createdAt).toISOString() : null,
          },
        },
      });
    }

    await this.dashboardVersionService.touchDashboard(userId, 'transaction.update');

    return {
      transaccion: actualizada,
      meta: {
        backdated,
        fechaEfectiva: fechaEfectiva.toISOString(),
        registradoEn: registradoEn.toISOString(),
      },
    };
  }

  async eliminar(id: string, userId: string) {
    const transaccion = await this.transactionModel.findOne({ transaccionId: id, userId });
    if (!transaccion) throw new NotFoundException('Transacción no encontrada');

    const txObj: any = transaccion.toObject();
    const revertResult = await this.aplicarBalances(txObj, -1);

    await this.transactionModel.deleteOne({ transaccionId: id, userId });

    // Historial subcuenta (auditoría simple)
    await this.historialModel.create({
      subcuentaId: txObj.subCuentaId ?? null,
      userId: txObj.userId,
      tipo: 'eliminacion',
      descripcion: 'Transacción eliminada',
      datos: { transaccionId: id, concepto: txObj.concepto, monto: txObj.monto, tipoTransaccion: txObj.tipo },
    });

    if (revertResult?.cuentaId) {
      await this.historialService.marcarTransaccionEliminada({
        cuentaId: revertResult.cuentaId,
        userId,
        transaccionId: id,
        deletedAt: new Date(),
        descripcion: 'Transacción eliminada',
        extra: {
          source: 'transaction',
          action: 'delete',
        },
      });
    }

    await this.dashboardVersionService.touchDashboard(userId, 'transaction.delete');

    return { message: 'Transacción eliminada correctamente' };
  }

  async listar(
    userId: string,
    input?:
      | string
      | {
          rango?: string;
          fechaInicio?: string;
          fechaFin?: string;
          moneda?: string;
          withTotals?: boolean;
        },
  ) {
    const opts = typeof input === 'string' ? { rango: input } : (input ?? {});
    const query: any = { userId };

    // Si vienen fechas explícitas, siempre priorizarlas
    if (opts.fechaInicio && opts.fechaFin) {
      const desde = this.parseDateInput(opts.fechaInicio, false);
      const hasta = this.parseDateInput(opts.fechaFin, true);
      query.$or = [
        { fecha: { $gte: desde, $lte: hasta } },
        { fecha: { $exists: false }, createdAt: { $gte: desde, $lte: hasta } },
      ];
    } else if (opts.rango) {
      const now = new Date();
      let desde: Date | null = null;
      let hasta: Date | null = null;

      switch (opts.rango) {
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
        query.$or = [
          { fecha: { $gte: desde, $lte: hasta } },
          { fecha: { $exists: false }, createdAt: { $gte: desde, $lte: hasta } },
        ];
      } else if (desde) {
        query.$or = [
          { fecha: { $gte: desde } },
          { fecha: { $exists: false }, createdAt: { $gte: desde } },
        ];
      }
    }

    if (opts.moneda) {
      query.$or = [{ moneda: opts.moneda }, { monedaConvertida: opts.moneda }];
    }

    const data = await this.transactionModel.find(query).sort({ fecha: -1, createdAt: -1 });

    const normalized = (data ?? []).map((t: any) => {
      const fechaEfectiva = t.fecha ? new Date(t.fecha) : new Date(t.createdAt || Date.now());
      const registradoEn = t.registradoEn ? new Date(t.registradoEn) : new Date(t.createdAt || Date.now());
      const isBackdated = !this.sameUtcYmd(fechaEfectiva, registradoEn);
      return {
        ...t.toObject?.() ?? t,
        fechaEfectiva: fechaEfectiva.toISOString(),
        registradoEn: registradoEn.toISOString(),
        isBackdated,
      };
    });

    if (!opts.withTotals) {
      return normalized;
    }

    const totals = (normalized ?? []).reduce(
      (acc: { ingresos: number; egresos: number }, t: any) => {
        const amount = Number(t?.montoConvertido ?? t?.monto ?? 0);
        if (t?.tipo === 'ingreso') acc.ingresos += amount;
        if (t?.tipo === 'egreso') acc.egresos += amount;
        return acc;
      },
      { ingresos: 0, egresos: 0 },
    );

    return { data: normalized, totals };
  }

  private async aplicarBalances(t: any, direction: 1 | -1): Promise<any> {
    let subcuentaResult: { subCuentaId: string } | null = null;
    let historialResult: { cuentaId: string } | null = null;

    const signoBase = t.tipo === 'ingreso' ? 1 : -1;
    const signo = signoBase * direction;
    const montoOriginalFirmado = signoBase * Math.abs(t.monto);

    const metadata: Record<string, any> = {};

    if (t.subCuentaId) {
      const subcuenta = await this.subcuentaModel.findOne({ subCuentaId: t.subCuentaId, userId: t.userId });
      if (!subcuenta) throw new NotFoundException('Subcuenta no encontrada');

      let montoSubcuentaAbs = Math.abs(t.monto);
      let conversionSubcuenta: any = null;

      if (direction === -1 && t.montoSubcuentaConvertido && t.monedaSubcuentaConvertida === subcuenta.moneda) {
        montoSubcuentaAbs = Math.abs(t.montoSubcuentaConvertido);
      } else if (t.moneda && subcuenta.moneda && t.moneda !== subcuenta.moneda) {
        conversionSubcuenta = await this.conversionService.convertir(
          Math.abs(t.monto),
          t.moneda,
          subcuenta.moneda,
        );
        montoSubcuentaAbs = conversionSubcuenta.montoConvertido;
      }

      const montoAjustadoSubcuenta = signo * montoSubcuentaAbs;

      if (montoAjustadoSubcuenta < 0 && subcuenta.cantidad + montoAjustadoSubcuenta < 0) {
        throw new BadRequestException(
          `No puede retirar más de ${subcuenta.cantidad} desde la subcuenta "${subcuenta.nombre}".`
        );
      }

      await this.subcuentaModel.updateOne(
        { subCuentaId: t.subCuentaId, userId: t.userId },
        { $inc: { cantidad: montoAjustadoSubcuenta } }
      );

      subcuentaResult = { subCuentaId: t.subCuentaId };

      if (direction === 1) {
        await this.transactionModel.updateOne(
          { transaccionId: (t as any).transaccionId },
          {
            $set: {
              montoSubcuentaConvertido: montoSubcuentaAbs,
              monedaSubcuentaConvertida: subcuenta.moneda,
              tasaConversionSubcuenta: conversionSubcuenta?.tasaConversion ?? null,
              fechaConversionSubcuenta: conversionSubcuenta?.fechaConversion ?? null,
            },
          },
        );
      }

      metadata.conversionSubcuenta = {
        monedaDestino: subcuenta.moneda,
        montoDestino: signoBase * montoSubcuentaAbs,
        tasaConversion: conversionSubcuenta?.tasaConversion ?? null,
        fechaConversion: conversionSubcuenta?.fechaConversion ?? null,
      };

      if (t.afectaCuenta && (t.cuentaId || subcuenta.cuentaId)) {
        const cuentaId = t.cuentaId || subcuenta.cuentaId;
        const cuenta = await this.cuentaModel.findOne({ id: cuentaId, userId: t.userId });
        if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');

        let montoCuentaAbs = Math.abs(t.monto);
        let conversionCuenta: any = null;

        if (direction === -1 && t.montoConvertido && t.monedaConvertida === cuenta.moneda) {
          montoCuentaAbs = Math.abs(t.montoConvertido);
        } else if (t.moneda && cuenta.moneda && t.moneda !== cuenta.moneda) {
          conversionCuenta = await this.conversionService.convertir(
            Math.abs(t.monto),
            t.moneda,
            cuenta.moneda,
          );
          montoCuentaAbs = conversionCuenta.montoConvertido;
        }

        const montoAjustadoCuenta = signo * montoCuentaAbs;

        if (montoAjustadoCuenta < 0 && cuenta.cantidad + montoAjustadoCuenta < 0) {
          throw new BadRequestException(
            `No puede retirar más de ${cuenta.cantidad} desde la cuenta principal, ya que parte del saldo está reservado en subcuentas.`
          );
        }

        await this.cuentaModel.updateOne(
          { id: cuentaId, userId: t.userId },
          { $inc: { cantidad: montoAjustadoCuenta } }
        );

        if (direction === 1) {
          await this.transactionModel.updateOne(
            { transaccionId: (t as any).transaccionId },
            {
              $set: {
                montoConvertido: montoCuentaAbs,
                monedaConvertida: cuenta.moneda,
                tasaConversion: conversionCuenta?.tasaConversion ?? null,
                fechaConversion: conversionCuenta?.fechaConversion ?? null,
              },
            },
          );
        }

        metadata.monedaOrigen = t.moneda;
        metadata.montoOriginal = montoOriginalFirmado;
        metadata.monedaDestino = cuenta.moneda;
        metadata.montoDestino = signoBase * montoCuentaAbs;
        metadata.tasaConversion = conversionCuenta?.tasaConversion ?? null;
        metadata.fechaConversion = conversionCuenta?.fechaConversion ?? null;

        historialResult = { cuentaId };
        return {
          subcuenta: subcuentaResult,
          historial: historialResult,
          cuentaId,
          cuentaDelta: montoAjustadoCuenta,
          metadata,
        };
      }

      return { subcuenta: subcuentaResult, historial: null, metadata };
    }

    if (t.afectaCuenta && t.cuentaId) {
      const cuenta = await this.cuentaModel.findOne({ id: t.cuentaId, userId: t.userId });
      if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');

      let montoCuentaAbs = Math.abs(t.monto);
      let conversionCuenta: any = null;

      if (direction === -1 && t.montoConvertido && t.monedaConvertida === cuenta.moneda) {
        montoCuentaAbs = Math.abs(t.montoConvertido);
      } else if (t.moneda && cuenta.moneda && t.moneda !== cuenta.moneda) {
        conversionCuenta = await this.conversionService.convertir(
          Math.abs(t.monto),
          t.moneda,
          cuenta.moneda,
        );
        montoCuentaAbs = conversionCuenta.montoConvertido;
      }

      const montoAjustadoCuenta = signo * montoCuentaAbs;

      if (montoAjustadoCuenta < 0 && cuenta.cantidad + montoAjustadoCuenta < 0) {
        throw new BadRequestException(`No puede retirar más de ${cuenta.cantidad} desde la cuenta principal.`);
      }

      await this.cuentaModel.updateOne(
        { id: t.cuentaId, userId: t.userId },
        { $inc: { cantidad: montoAjustadoCuenta } }
      );

      if (direction === 1) {
        await this.transactionModel.updateOne(
          { transaccionId: (t as any).transaccionId },
          {
            $set: {
              montoConvertido: montoCuentaAbs,
              monedaConvertida: cuenta.moneda,
              tasaConversion: conversionCuenta?.tasaConversion ?? null,
              fechaConversion: conversionCuenta?.fechaConversion ?? null,
            },
          },
        );
      }

      metadata.monedaOrigen = t.moneda;
      metadata.montoOriginal = montoOriginalFirmado;
      metadata.monedaDestino = cuenta.moneda;
      metadata.montoDestino = signoBase * montoCuentaAbs;
      metadata.tasaConversion = conversionCuenta?.tasaConversion ?? null;
      metadata.fechaConversion = conversionCuenta?.fechaConversion ?? null;

      historialResult = { cuentaId: t.cuentaId };
      return {
        subcuenta: null,
        historial: historialResult,
        cuentaId: t.cuentaId,
        cuentaDelta: montoAjustadoCuenta,
        metadata,
      };
    }

    return { subcuenta: null, historial: null, metadata };
  }

  async obtenerHistorial({ subCuentaId, desde, hasta, limite, pagina, descripcion }) {
    const filtros: any = {};
  
    if (subCuentaId) {
      filtros.subcuentaId = subCuentaId;
    }
  
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
        .skip(Math.max(0, (pagina - 1) * limite))
        .limit(Math.max(1, limite)),
      this.historialModel.countDocuments(filtros),
    ]);
  
    return {
      resultados,
      totalPaginas: total > 0 ? Math.ceil(total / Math.max(1, limite)) : 0,
    };
  }

  async aplicarTransaccion(t: Transaction): Promise<any> {
    let subcuentaResult: { subCuentaId: string } | null = null;
    let historialResult: { cuentaId: string } | null = null;

    const signo = t.tipo === 'ingreso' ? 1 : -1;
    const montoOriginalFirmado = signo * Math.abs(t.monto);
  
    if (t.subCuentaId) {
      const subcuenta = await this.subcuentaModel.findOne({ subCuentaId: t.subCuentaId, userId: t.userId });
      if (!subcuenta) throw new NotFoundException('Subcuenta no encontrada');

      // Ajuste en subcuenta: convertir a moneda de la subcuenta si aplica
      let montoSubcuenta = Math.abs(t.monto);
      let conversionSubcuenta: any = null;
      if (t.moneda && subcuenta.moneda && t.moneda !== subcuenta.moneda) {
        conversionSubcuenta = await this.conversionService.convertir(
          Math.abs(t.monto),
          t.moneda,
          subcuenta.moneda,
        );
        montoSubcuenta = conversionSubcuenta.montoConvertido;
      }

      const montoAjustadoSubcuenta = signo * montoSubcuenta;
  
      if (t.tipo === 'egreso' && subcuenta.cantidad + montoAjustadoSubcuenta < 0) {
        throw new BadRequestException(
          `No puede retirar más de ${subcuenta.cantidad} desde la subcuenta "${subcuenta.nombre}".`
        );
      }
  
      await this.subcuentaModel.updateOne(
        { subCuentaId: t.subCuentaId, userId: t.userId },
        { $inc: { cantidad: montoAjustadoSubcuenta } }
      );
  
      subcuentaResult = { subCuentaId: t.subCuentaId };
  
      if (t.afectaCuenta && subcuenta.cuentaId) {
        const cuenta = await this.cuentaModel.findOne({ id: subcuenta.cuentaId, userId: t.userId });
        if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');

        // Ajuste en cuenta: convertir a moneda de la cuenta si aplica
        let montoCuenta = Math.abs(t.monto);
        let conversionCuenta: any = null;
        if (t.moneda && cuenta.moneda && t.moneda !== cuenta.moneda) {
          conversionCuenta = await this.conversionService.convertir(
            Math.abs(t.monto),
            t.moneda,
            cuenta.moneda,
          );
          montoCuenta = conversionCuenta.montoConvertido;

          // Persistir conversión para listados (montoConvertido siempre en moneda de cuenta cuando afectaCuenta)
          await this.transactionModel.updateOne(
            { transaccionId: (t as any).transaccionId },
            {
              $set: {
                montoConvertido: conversionCuenta.montoConvertido,
                monedaConvertida: cuenta.moneda,
                tasaConversion: conversionCuenta.tasaConversion,
                fechaConversion: conversionCuenta.fechaConversion,
              },
            },
          );
        }

        const montoAjustadoCuenta = signo * montoCuenta;
  
        if (t.tipo === 'egreso' && cuenta.cantidad + montoAjustadoCuenta < 0) {
          throw new BadRequestException(
            `No puede retirar más de ${cuenta.cantidad} desde la cuenta principal, ya que parte del saldo está reservado en subcuentas.`
          );
        }
  
        await this.cuentaModel.updateOne(
          { id: subcuenta.cuentaId, userId: t.userId },
          { $inc: { cantidad: montoAjustadoCuenta } }
        );
  
        await this.historialService.registrarMovimiento({
          userId: t.userId,
          cuentaId: subcuenta.cuentaId,
          monto: montoAjustadoCuenta,
          tipo: t.tipo,
          descripcion: `Transacción de tipo ${t.tipo} aplicada desde la subcuenta "${subcuenta.nombre}"`,
          fecha: new Date().toISOString(),
          subcuentaId: t.subCuentaId,
          motivo: t.motivo,
          conceptoId: (t as any).concepto,
          metadata: {
            monedaOrigen: t.moneda,
            montoOriginal: montoOriginalFirmado,
            monedaDestino: cuenta.moneda,
            montoDestino: montoAjustadoCuenta,
            tasaConversion: conversionCuenta?.tasaConversion ?? null,
            fechaConversion: conversionCuenta?.fechaConversion ?? null,
            conversionSubcuenta: conversionSubcuenta
              ? {
                  monedaDestino: subcuenta.moneda,
                  montoDestino: montoAjustadoSubcuenta,
                  tasaConversion: conversionSubcuenta.tasaConversion,
                  fechaConversion: conversionSubcuenta.fechaConversion,
                }
              : null,
          },
        });
        historialResult = { cuentaId: subcuenta.cuentaId };
      }
    } else if (t.afectaCuenta && t.cuentaId) {
      const cuenta = await this.cuentaModel.findOne({ id: t.cuentaId, userId: t.userId });
      if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');

      let montoCuenta = Math.abs(t.monto);
      let conversionCuenta: any = null;
      if (t.moneda && cuenta.moneda && t.moneda !== cuenta.moneda) {
        conversionCuenta = await this.conversionService.convertir(
          Math.abs(t.monto),
          t.moneda,
          cuenta.moneda,
        );
        montoCuenta = conversionCuenta.montoConvertido;

        await this.transactionModel.updateOne(
          { transaccionId: (t as any).transaccionId },
          {
            $set: {
              montoConvertido: conversionCuenta.montoConvertido,
              monedaConvertida: cuenta.moneda,
              tasaConversion: conversionCuenta.tasaConversion,
              fechaConversion: conversionCuenta.fechaConversion,
            },
          },
        );
      }

      const montoAjustadoCuenta = signo * montoCuenta;
  
      if (t.tipo === 'egreso' && cuenta.cantidad + montoAjustadoCuenta < 0) {
        throw new BadRequestException(
          `No puede retirar más de ${cuenta.cantidad} desde la cuenta principal.`
        );
      }
  
      await this.cuentaModel.updateOne(
        { id: t.cuentaId, userId: t.userId },
        { $inc: { cantidad: montoAjustadoCuenta } }
      );
  
      await this.historialService.registrarMovimiento({
        userId: t.userId,
        cuentaId: t.cuentaId,
        monto: montoAjustadoCuenta,
        tipo: t.tipo,
        descripcion: `Transacción de tipo ${t.tipo} aplicada`,
        fecha: new Date().toISOString(),
        motivo: t.motivo,
        conceptoId: (t as any).concepto,
        metadata: {
          monedaOrigen: t.moneda,
          montoOriginal: montoOriginalFirmado,
          monedaDestino: cuenta.moneda,
          montoDestino: montoAjustadoCuenta,
          tasaConversion: conversionCuenta?.tasaConversion ?? null,
          fechaConversion: conversionCuenta?.fechaConversion ?? null,
        },
      });
      historialResult = { cuentaId: t.cuentaId };
    }
  
    return { subcuenta: subcuentaResult, historial: historialResult };
  }
}