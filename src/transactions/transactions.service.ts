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

  async crear(dto: CreateTransactionDto, userId: string) {
    const transaccionId = await generateUniqueId(this.transactionModel, 'transaccionId');
  
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
    
    const result: { subcuenta?: any; historial?: any } = await this.aplicarTransaccion({
      ...guardada.toObject(),
      motivo: dto.motivo,
      concepto: dto.concepto
    });

    await this.dashboardVersionService.touchDashboard(userId, 'transaction.create');
  
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
        motivo: dto.motivo,
      });
    }

    await this.dashboardVersionService.touchDashboard(userId, 'transaction.update');
  
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

    await this.dashboardVersionService.touchDashboard(userId, 'transaction.delete');

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