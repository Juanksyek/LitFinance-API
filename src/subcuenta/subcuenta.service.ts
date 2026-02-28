import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subcuenta, SubcuentaDocument } from './schemas/subcuenta.schema/subcuenta.schema';
import { CreateSubcuentaDto } from './dto/create-subcuenta.dto/create-subcuenta.dto';
import { UpdateSubcuentaDto } from './dto/update-subcuenta.dto/update-subcuenta.dto';
import { DeleteSubcuentaDto } from './dto/delete-subcuenta.dto/delete-subcuenta.dto';
import { Cuenta } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { InjectModel as InjectCuentaModel } from '@nestjs/mongoose';
import { MonedaService } from '../moneda/moneda.service';
import { SubcuentaHistorial, SubcuentaHistorialDocument } from './schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';
import { generateUniqueId } from '../utils/generate-id';
import { ConversionService } from '../utils/services/conversion.service';
import { UserService } from '../user/user.service';
import { Transaction, TransactionDocument } from '../transactions/schemas/transaction.schema/transaction.schema';
import { HistorialRecurrente, HistorialRecurrenteDocument } from '../recurrentes/schemas/historial-recurrente.schema';
import { Recurrente, RecurrenteDocument } from '../recurrentes/schemas/recurrente.schema';
import { PlanConfigService } from '../plan-config/plan-config.service';
import { DashboardVersionService } from '../user/services/dashboard-version.service';

@Injectable()
export class SubcuentaService {
  constructor(
    @InjectModel(Subcuenta.name) private subcuentaModel: Model<SubcuentaDocument>,
    @InjectCuentaModel(Cuenta.name) private cuentaModel: Model<Cuenta>,
    private readonly monedaService: MonedaService,
    @InjectModel(SubcuentaHistorial.name) private historialModel: Model<SubcuentaHistorialDocument>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(HistorialRecurrente.name) private readonly historialRecurrenteModel: Model<HistorialRecurrenteDocument>,
    @InjectModel(Recurrente.name) private readonly recurrenteModel: Model<RecurrenteDocument>,
    private readonly cuentaHistorialService: CuentaHistorialService,
    private readonly conversionService: ConversionService,
    private readonly userService: UserService,
    private readonly planConfigService: PlanConfigService,
    private readonly dashboardVersionService: DashboardVersionService,
  ) {}

  private async convertirSiNecesario(params: {
    monto: number;
    monedaOrigen?: string;
    monedaDestino?: string;
  }): Promise<{ montoConvertido: number; tasaConversion?: number } > {
    const { monto, monedaOrigen, monedaDestino } = params;
    if (!monedaOrigen || !monedaDestino || monedaOrigen === monedaDestino) {
      return { montoConvertido: monto };
    }

    const conversion = await this.conversionService.convertir(monto, monedaOrigen, monedaDestino);
    return { montoConvertido: conversion.montoConvertido, tasaConversion: conversion.tasaConversion };
  }

  async obtenerMovimientosFinancieros(
    subCuentaId: string,
    userId: string,
    opts?: {
      page?: number;
      limit?: number;
      desde?: string;
      hasta?: string;
      search?: string;
    },
  ) {
    const page = Math.max(1, Number(opts?.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(opts?.limit ?? 20)));
    const search = (opts?.search ?? '').trim();

    // Validar que la subcuenta exista y pertenezca al usuario
    const sub = await this.subcuentaModel.findOne({ subCuentaId, userId }).lean();
    if (!sub) throw new NotFoundException('Subcuenta no encontrada');

    const desdeDate = opts?.desde ? new Date(opts.desde) : null;
    const hastaDate = opts?.hasta ? new Date(opts.hasta) : null;

    const txQuery: any = { userId, subCuentaId };
    if (desdeDate || hastaDate) {
      txQuery.createdAt = {};
      if (desdeDate) txQuery.createdAt.$gte = desdeDate;
      if (hastaDate) txQuery.createdAt.$lte = hastaDate;
    }
    if (search) {
      txQuery.$or = [
        { concepto: { $regex: search, $options: 'i' } },
        { motivo: { $regex: search, $options: 'i' } },
        { tipo: { $regex: search, $options: 'i' } },
      ];
    }

    const recQuery: any = { userId, subcuentaId: subCuentaId, estado: 'exitoso' };
    if (desdeDate || hastaDate) {
      recQuery.fecha = {};
      if (desdeDate) recQuery.fecha.$gte = desdeDate;
      if (hastaDate) recQuery.fecha.$lte = hastaDate;
    }
    if (search) {
      recQuery.$or = [
        { nombreRecurrente: { $regex: search, $options: 'i' } },
        { 'plataforma.nombre': { $regex: search, $options: 'i' } },
      ];
    }

    const [txs, recs] = await Promise.all([
      this.transactionModel.find(txQuery).sort({ createdAt: -1 }).lean(),
      this.historialRecurrenteModel.find(recQuery).sort({ fecha: -1 }).lean(),
    ]);

    const movimientosTx = txs.map((t: any) => ({
      source: 'transaccion' as const,
      tipo: t.tipo,
      transaccionId: t.transaccionId,
      subcuentaId: t.subCuentaId,
      cuentaId: t.cuentaId ?? null,
      afectaCuenta: !!t.afectaCuenta,
      concepto: t.concepto,
      motivo: t.motivo ?? null,
      moneda: t.moneda,
      monedaConvertida: t.monedaConvertida ?? null,
      monto: t.tipo === 'egreso' ? -Math.abs(t.monto) : Math.abs(t.monto),
      montoOriginal: t.monto,
      montoConvertido: t.montoConvertido ?? null,
      tasaConversion: t.tasaConversion ?? null,
      fecha: (t.createdAt ? new Date(t.createdAt) : new Date()).toISOString(),
      createdAt: t.createdAt ?? null,
      updatedAt: t.updatedAt ?? null,
    }));

    const movimientosRec = recs.map((r: any) => ({
      source: 'recurrente' as const,
      tipo: 'recurrente' as const,
      recurrenteId: r.recurrenteId,
      subcuentaId: r.subcuentaId ?? null,
      cuentaId: r.cuentaId ?? null,
      afectaCuentaPrincipal: !!r.afectaCuentaPrincipal,
      nombreRecurrente: r.nombreRecurrente,
      plataforma: r.plataforma ?? null,
      moneda: r.moneda,
      monedaConvertida: r.monedaConvertida ?? null,
      monto: -(r.montoConvertido ?? r.monto),
      montoOriginal: r.monto,
      montoConvertido: r.montoConvertido ?? null,
      tasaConversion: r.tasaConversion ?? null,
      montoConvertidoCuenta: r.montoConvertidoCuenta ?? null,
      monedaConvertidaCuenta: r.monedaConvertidaCuenta ?? null,
      tasaConversionCuenta: r.tasaConversionCuenta ?? null,
      montoConvertidoSubcuenta: r.montoConvertidoSubcuenta ?? null,
      monedaConvertidaSubcuenta: r.monedaConvertidaSubcuenta ?? null,
      tasaConversionSubcuenta: r.tasaConversionSubcuenta ?? null,
      fecha: (r.fecha ? new Date(r.fecha) : new Date()).toISOString(),
      estado: r.estado,
    }));

    const todos = [...movimientosTx, ...movimientosRec].sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
    );

    const total = todos.length;
    const start = (page - 1) * limit;
    const end = start + limit;

    return {
      subcuenta: { id: sub.subCuentaId, nombre: sub.nombre, moneda: sub.moneda },
      total,
      page,
      limit,
      hasNextPage: end < total,
      data: todos.slice(start, end),
    };
  }

  async crear(dto: CreateSubcuentaDto, userId: string) {
  
    const {
      cuentaPrincipalId,
      tipoHistorialCuenta,
      descripcionHistorialCuenta,
      userId: _omitUserId,
      ...restoDto
    } = dto;
  
    const subCuentaId = await generateUniqueId(this.subcuentaModel, 'subCuentaId');
  
    const payload = {
      ...restoDto,
      userId,
      subCuentaId,
      cuentaId: cuentaPrincipalId,
      origenSaldo: dto.usarSaldoCuentaPrincipal ? 'cuenta_principal' : 'nuevo',
    };
  
    const subcuenta = new this.subcuentaModel(payload);
    subcuenta.set('subsubCuentaId', await generateUniqueId(this.subcuentaModel));
  
    // Si afecta cuenta y existe cuenta principal, calcular conversión
    if (dto.afectaCuenta && cuentaPrincipalId) {
      const cuenta = await this.cuentaModel.findOne({ id: cuentaPrincipalId, userId });
      if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');

      let cantidadAjustada = dto.cantidad;

      if (dto.moneda && dto.moneda !== cuenta.moneda) {
        const conversion = await this.conversionService.convertir(
          dto.cantidad,
          dto.moneda,
          cuenta.moneda,
        );
        cantidadAjustada = conversion.montoConvertido;

        // Guardar metadata de conversión en la subcuenta
        subcuenta.montoConvertido = conversion.montoConvertido;
        subcuenta.tasaConversion = conversion.tasaConversion;
        subcuenta.fechaConversion = conversion.fechaConversion;
      }

      const tipo = dto.tipoHistorialCuenta || 'ajuste_subcuenta';

      // Modo "apartado": valida que exista saldo suficiente, pero NO modifica el saldo de la cuenta
      // (evita inflar el saldo total al crear subcuentas con saldo ya existente)
      if (dto.usarSaldoCuentaPrincipal) {
        if (cuenta.cantidad < cantidadAjustada) {
          throw new BadRequestException(
            `Saldo insuficiente en la cuenta principal para apartar ${cantidadAjustada}. Disponible: ${cuenta.cantidad}`,
          );
        }

        const descripcion =
          dto.descripcionHistorialCuenta ||
          `Subcuenta creada como apartado (monto: ${cantidadAjustada} ${cuenta.moneda})`;

        await this.cuentaHistorialService.registrarMovimiento({
          userId,
          cuentaId: cuentaPrincipalId,
          monto: 0,
          tipo,
          descripcion,
          fecha: new Date().toISOString(),
          subcuentaId: subCuentaId,
        });
      } else {
        // Modo "nuevo saldo": conserva comportamiento actual (la creación suma al saldo de la cuenta)
        await this.cuentaModel.findOneAndUpdate(
          { id: cuentaPrincipalId, userId },
          { $inc: { cantidad: cantidadAjustada } },
        );

        const descripcion = dto.descripcionHistorialCuenta || 'Subcuenta creada con afectación';

        await this.cuentaHistorialService.registrarMovimiento({
          userId,
          cuentaId: cuentaPrincipalId,
          monto: cantidadAjustada,
          tipo,
          descripcion,
          fecha: new Date().toISOString(),
          subcuentaId: subCuentaId,
        });
      }
    }

    const creada = await subcuenta.save();

    await this.historialModel.create({
      subcuentaId: creada._id,
      userId,
      tipo: 'creacion',
      descripcion: 'Subcuenta creada exitosamente',
      datos: { ...dto, cuentaPrincipalId, subCuentaId },
    });

    await this.dashboardVersionService.touchDashboard(userId, 'subcuenta.create');
  
    return {
      ...creada.toObject(),
      subCuentaId,
    };
  }

  async listar( userId: string, subCuentaId?: string, search = '', page = 1, limit = 10, incluirInactivas = true, excluirMeta = true ) {
    const query: any = { userId };
  
    if (!incluirInactivas) {
      query.activa = true;
    }

    // Por defecto ocultamos las subcuentas marcadas como `isMeta` para no confundir
    // la vista de subcuentas del usuario con subcuentas internas usadas por metas.
    if (excluirMeta) {
      query.isMeta = { $ne: true };
    }
  
    if (subCuentaId) query.subCuentaId = subCuentaId;
    if (search) query.nombre = { $regex: search, $options: 'i' };
  
    const skip = (page - 1) * limit;
    
    const [items, totalCount] = await Promise.all([
      this.subcuentaModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.subcuentaModel.countDocuments(query),
    ]);

    // Obtener el planType del usuario para calcular límites
    let itemsWithPauseStatus = items;
    try {
      const userProfile = await this.userService.getProfile(userId);
      const planType = userProfile?.planType || 'free_plan';
      
      // 🔥 Consultar límite dinámicamente desde PlanConfig
      const planConfig = await this.planConfigService.findByPlanType(planType);
      const planLimit = planConfig?.subcuentasPorUsuario === -1 
        ? Infinity 
        : (planConfig?.subcuentasPorUsuario || 5);
      
      console.log('🔍 [SubcuentaService] Aplicando límites:', {
        userId,
        totalCount,
        planLimit,
        planType,
        currentPage: page,
        skip,
      });
      
      // Si excede el límite, marcar las más antiguas como pausadas
      if (totalCount > planLimit) {
        const startIndex = skip;
        
        itemsWithPauseStatus = items.map((sub, localIndex) => {
          const globalIndex = startIndex + localIndex;
          
          // Las primeras 'planLimit' items globalmente están activas
          // Las demás están pausadas
          const shouldBePaused = globalIndex >= planLimit;
          
          return {
            ...sub,
            pausadaPorPlan: shouldBePaused || sub.pausadaPorPlan || false,
          };
        });
        
        console.log('✅ [SubcuentaService] Items marcadas:', 
          itemsWithPauseStatus.map((s, i) => ({
            nombre: s.nombre,
            globalIndex: startIndex + i,
            pausadaPorPlan: s.pausadaPorPlan,
          }))
        );
      }
    } catch (error) {
      console.error('❌ [SubcuentaService] Error al aplicar límites:', error.message);
      // En caso de error, devolver items sin modificar
    }
    
    return itemsWithPauseStatus;
  }

  async buscarPorSubCuentaId(subCuentaId: string) {
    const resultado = await this.subcuentaModel.findOne({ subCuentaId }).lean();
    if (!resultado) {
      throw new NotFoundException(`Subcuenta no encontrada`);
    }
    return resultado;
  }

  async actualizar(id: string, dto: UpdateSubcuentaDto) {
    const antes = await this.subcuentaModel.findOne({ subCuentaId: id });
    if (!antes) throw new NotFoundException('Subcuenta no encontrada');
  
    let cambios: Record<string, { antes: any; despues: any }> = {};
  
    // Si cambia la moneda, recalcular cantidad en la nueva moneda
    if (dto.moneda && dto.moneda !== antes.moneda) {
      const conversion = await this.conversionService.convertir(
        antes.cantidad,
        antes.moneda,
        dto.moneda,
      );
      const nuevaCantidad = conversion.montoConvertido;
  
      dto.cantidad = nuevaCantidad;
  
      cambios['moneda'] = { antes: antes.moneda, despues: dto.moneda };
      cambios['cantidad'] = { antes: antes.cantidad, despues: nuevaCantidad };
    }
  
    const actualizado = await this.subcuentaModel.findOneAndUpdate(
      { subCuentaId: id },
      dto,
      { new: true }
    );
  
    if (actualizado) {
      for (const key of Object.keys(dto)) {
        const nuevoValor = dto[key];
        const valorAnterior = antes[key];
  
        if (
          nuevoValor !== undefined &&
          JSON.stringify(nuevoValor) !== JSON.stringify(valorAnterior) &&
          !cambios[key]
        ) {
          cambios[key] = {
            antes: valorAnterior,
            despues: actualizado[key],
          };
        }
      }
  
      await this.historialModel.create({
        subcuentaId: actualizado.subCuentaId,
        userId: actualizado.userId,
        tipo: 'modificacion',
        descripcion: 'Subcuenta modificada exitosamente',
        datos: cambios,
      });

      await this.dashboardVersionService.touchDashboard(actualizado.userId, 'subcuenta.update');
    }
  
    return actualizado;
  }

  async eliminar(id: string, userId: string) {
    try {
  
      const sub = await this.subcuentaModel.findOne({ subCuentaId: id });
      if (!sub || sub.userId !== userId) {
        throw new NotFoundException('Subcuenta no encontrada o no pertenece al usuario');
      }      
      if (sub.afectaCuenta && sub.cuentaId && sub.origenSaldo !== 'cuenta_principal') {
        const cuenta = await this.cuentaModel.findOne({ id: sub.cuentaId, userId });
  
        if (cuenta) {
          let cantidadAjustada = sub.cantidad;
  
          if (sub.moneda && cuenta.moneda && sub.moneda !== cuenta.moneda) {
            const conversion = await this.conversionService.convertir(
              sub.cantidad,
              sub.moneda,
              cuenta.moneda,
            );
            cantidadAjustada = conversion.montoConvertido;
          }
  
          const resultado = await this.cuentaModel.findOneAndUpdate(
            { id: sub.cuentaId, userId },
            { $inc: { cantidad: -cantidadAjustada } },
          );
    
          await this.cuentaHistorialService.registrarMovimiento({
            userId,
            cuentaId: sub.cuentaId,
            monto: -cantidadAjustada,
            tipo: 'ajuste_subcuenta',
            descripcion: `Ajuste por eliminación de subcuenta: ${sub.nombre}`,
            fecha: new Date().toISOString(),
            subcuentaId: sub.subCuentaId,
          });
        } else {  
          await this.cuentaHistorialService.registrarMovimiento({
            userId,
            cuentaId: sub.cuentaId,
            monto: 0,
            tipo: 'ajuste_subcuenta',
            descripcion: `Eliminación de subcuenta: ${sub.nombre}`,
            fecha: new Date().toISOString(),
            subcuentaId: sub.subCuentaId,
          });
        }
      }
  
      await sub.deleteOne();
  
      await this.historialModel.create({
        subcuentaId: sub.subCuentaId,
        userId,
        tipo: 'eliminacion',
        descripcion: 'Subcuenta eliminada exitosamente',
        datos: { id },
      });

      await this.dashboardVersionService.touchDashboard(userId, 'subcuenta.delete');
  
      return { message: 'Subcuenta eliminada' };
  
    } catch (err) {
      throw new InternalServerErrorException('Error interno al eliminar subcuenta');
    }
  }

  /**
   * Elimina una subcuenta con una decisión explícita sobre el saldo restante:
   * - transfer_to_principal: reubicar saldo hacia la cuenta principal
   * - discard: descartar saldo (ajuste negativo en cuenta principal si la subcuenta afecta la cuenta)
   *
   * Además, limpia historial de movimientos financieros (transacciones + recurrentes ejecutados)
   * y definiciones de recurrentes asociadas a la subcuenta.
   */
  async eliminarConDecision(id: string, userId: string, dto: DeleteSubcuentaDto) {
    const sub = await this.subcuentaModel.findOne({ subCuentaId: id, userId });
    if (!sub) {
      throw new NotFoundException('Subcuenta no encontrada o no pertenece al usuario');
    }

    if (sub.isMeta) {
      throw new BadRequestException('No se puede eliminar una subcuenta interna de Meta');
    }

    const action = dto.action;

    const cuentaId = sub.cuentaId ?? null;
    let cuenta: any = null;
    if (cuentaId) {
      cuenta = await this.cuentaModel.findOne({ id: cuentaId, userId });
    }

    const nowIso = new Date().toISOString();

    // Determinar ajuste sobre cuenta principal (si aplica)
    let principalDelta = 0;
    let tasaConversionUsada: number | null = null;

    const requiereCuentaPrincipal =
      action === 'transfer_to_principal' || (action === 'discard' && sub.afectaCuenta);

    if (requiereCuentaPrincipal) {
      if (!cuentaId) {
        throw new BadRequestException('La subcuenta no tiene cuenta principal asociada');
      }
      if (!cuenta) {
        throw new NotFoundException('Cuenta principal no encontrada');
      }
    }

    if (cuenta) {
      const { montoConvertido, tasaConversion } = await this.convertirSiNecesario({
        monto: sub.cantidad,
        monedaOrigen: sub.moneda,
        monedaDestino: cuenta.moneda,
      });
      tasaConversionUsada = tasaConversion ?? null;

      if (action === 'transfer_to_principal') {
        // Si NO afecta la cuenta, el saldo está fuera del agregado: hay que sumarlo.
        // Si afecta la cuenta, es una reasignación (sin cambio de saldo agregado).
        principalDelta = sub.afectaCuenta ? 0 : montoConvertido;
      } else if (action === 'discard') {
        // Si afecta la cuenta, descartar implica quitarlo del agregado.
        // Si NO afecta la cuenta, descartar no impacta la cuenta principal.
        principalDelta = sub.afectaCuenta ? -montoConvertido : 0;

        if (principalDelta < 0) {
          const nuevoSaldo = Number((cuenta.cantidad ?? 0) + principalDelta);
          if (nuevoSaldo < 0) {
            throw new BadRequestException(
              `Saldo insuficiente en la cuenta principal para descartar ${Math.abs(principalDelta)}. Disponible: ${cuenta.cantidad}`,
            );
          }
        }
      }
    }

    if (cuenta && principalDelta !== 0) {
      await this.cuentaModel.findOneAndUpdate(
        { id: cuentaId, userId },
        { $inc: { cantidad: principalDelta } },
      );
    }

    // Auditoría que sobrevive a la eliminación y limpieza
    if (cuentaId) {
      const descripcion =
        action === 'transfer_to_principal'
          ? `Eliminación de subcuenta (transferido a principal): ${sub.nombre}`
          : `Eliminación de subcuenta (descartado): ${sub.nombre}`;

      await this.cuentaHistorialService.registrarMovimiento({
        userId,
        cuentaId,
        monto: principalDelta,
        tipo: 'ajuste_subcuenta',
        descripcion,
        fecha: nowIso,
        subcuentaId: sub.subCuentaId,
        metadata: {
          action,
          note: dto.note ?? null,
          subcuenta: {
            subCuentaId: sub.subCuentaId,
            nombre: sub.nombre,
            moneda: sub.moneda,
            cantidad: sub.cantidad,
            afectaCuenta: !!sub.afectaCuenta,
            origenSaldo: sub.origenSaldo ?? null,
          },
          conversion: {
            tasaConversion: tasaConversionUsada,
          },
        },
      } as any);
    }

    const descripcionSub =
      action === 'transfer_to_principal'
        ? 'Subcuenta eliminada (saldo transferido a principal)'
        : 'Subcuenta eliminada (saldo descartado)';

    const historialSubcuentaIds = [sub.subCuentaId, String((sub as any)._id)].filter(Boolean);

    await this.historialModel.create({
      subcuentaId: sub.subCuentaId,
      userId,
      tipo: 'eliminacion',
      descripcion: descripcionSub,
      datos: {
        id,
        action,
        note: dto.note ?? null,
        snapshot: {
          subCuentaId: sub.subCuentaId,
          nombre: sub.nombre,
          moneda: sub.moneda,
          cantidad: sub.cantidad,
          afectaCuenta: !!sub.afectaCuenta,
          origenSaldo: sub.origenSaldo ?? null,
          cuentaId: sub.cuentaId ?? null,
        },
      },
    });

    // Limpiar historial de movimientos (financieros) y recurrentes asociados
    const [txDel, histRecDel, recDefDel] = await Promise.all([
      this.transactionModel.deleteMany({ userId, subCuentaId: sub.subCuentaId }),
      this.historialRecurrenteModel.deleteMany({ userId, subcuentaId: sub.subCuentaId }),
      this.recurrenteModel.deleteMany({ userId, subcuentaId: sub.subCuentaId }),
    ]);

    // Eliminar historial de cambios de la subcuenta (mantener la entrada de eliminación)
    await this.historialModel.deleteMany({
      userId,
      subcuentaId: { $in: historialSubcuentaIds },
      tipo: { $ne: 'eliminacion' },
    });

    await sub.deleteOne();
    await this.dashboardVersionService.touchDashboard(userId, 'subcuenta.delete');

    return {
      message: 'Subcuenta eliminada',
      action,
      principalDelta,
      deleted: {
        transactions: (txDel as any)?.deletedCount ?? 0,
        historialRecurrente: (histRecDel as any)?.deletedCount ?? 0,
        recurrentes: (recDefDel as any)?.deletedCount ?? 0,
      },
    };
  }

  async obtenerHistorial(
    subcuentaId: string | null,
    userId: string,
    tipo?: string,
    desde?: string,
    hasta?: string,
  ) {
    const query: any = { userId };
    if (subcuentaId) query.subcuentaId = subcuentaId;
  
    if (tipo) query.tipo = tipo;
  
    if (desde || hasta) {
      query.createdAt = {};
      if (desde) query.createdAt.$gte = new Date(desde);
      if (hasta) query.createdAt.$lte = new Date(hasta);
    }
  
    return this.historialModel.find(query).sort({ createdAt: -1 });
  }

  async desactivar(id: string, userId: string) {
    const updated = await this.subcuentaModel.findOneAndUpdate(
      { subCuentaId: id, userId },
      { $set: { activa: false } },
      { new: true }
    );
  
    if (!updated) throw new NotFoundException('Subcuenta no encontrada');
  
    await this.historialModel.create({
      subcuentaId: updated.subCuentaId,
      userId,
      tipo: 'desactivacion',
      descripcion: 'Subcuenta desactivada',
      datos: { activa: false },
    });

    await this.dashboardVersionService.touchDashboard(userId, 'subcuenta.deactivate');
  
    return updated;
  }

  async activar(id: string, userId: string) {
    const updated = await this.subcuentaModel.findOneAndUpdate(
      { subCuentaId: id, userId },
      { $set: { activa: true } },
      { new: true }
    );
  
    if (!updated) throw new NotFoundException('Subcuenta no encontrada');
  
    await this.historialModel.create({
      subcuentaId: updated.subCuentaId,
      userId,
      tipo: 'activacion',
      descripcion: 'Subcuenta reactivada',
      datos: { activa: true },
    });

    await this.dashboardVersionService.touchDashboard(userId, 'subcuenta.activate');
  
    return updated;
  }

  async calcularParticipacion(userId: string) {
    const subcuentas = await this.subcuentaModel.find({
      userId,
      activa: true,
    });
  
    const total = subcuentas.reduce((sum, sub) => sum + sub.cantidad, 0);
  
    return subcuentas.map((sub) => ({
      subsubCuentaId: sub._id,
      nombre: sub.nombre,
      cantidad: sub.cantidad,
      porcentaje: total > 0 ? (sub.cantidad / total) * 100 : 0,
    }));
  }

  async contarSubcuentas(userId: string): Promise<number> {
    // Contar solo subcuentas reales (excluir contenedores de Meta)
    return this.subcuentaModel.countDocuments({ userId, activa: true, isMeta: { $ne: true } });
  }
}