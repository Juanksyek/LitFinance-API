import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import Decimal from 'decimal.js';
import { Model } from 'mongoose';
import { TransactionsService } from '../transactions/transactions.service';
import { generateUniqueId } from '../utils/generate-id';
import { Cuenta } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { CreateTransactionDto } from '../transactions/dto/create-transaction.dto';
import { CreateBlocDto } from './dto/create-bloc.dto';
import { CreateBlocItemDto } from './dto/create-bloc-item.dto';
import { UpdateBlocItemDto } from './dto/update-bloc-item.dto';
import { CreateBlocItemsDto } from './dto/create-bloc-items.dto';
import { LiquidarBlocDto, LiquidarBlocPreviewDto } from './dto/liquidar-bloc.dto';
import { PatchBlocItemsDto, UpsertBlocItemDto } from './dto/patch-bloc-items.dto';
import { UpdateBlocDto } from './dto/update-bloc.dto';
import { Bloc, BlocDocument } from './schemas/bloc.schema';
import { BlocItem, BlocItemDocument } from './schemas/bloc-item.schema';
import { BlocLiquidation, BlocLiquidationDocument } from './schemas/bloc-liquidation.schema';
import { ExchangeRateService } from './services/exchange-rate.service';

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

@Injectable()
export class BlocsService {
  constructor(
    @InjectModel(Bloc.name) private readonly blocModel: Model<BlocDocument>,
    @InjectModel(BlocItem.name) private readonly itemModel: Model<BlocItemDocument>,
    @InjectModel(BlocLiquidation.name) private readonly liquidationModel: Model<BlocLiquidationDocument>,
    @InjectModel(Cuenta.name) private readonly cuentaModel: Model<Cuenta>,
    @InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<Subcuenta>,
    private readonly transactionsService: TransactionsService,
    private readonly exchangeRateService: ExchangeRateService,
  ) {}

  private toMoney(n: Decimal): number {
    return n.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  }

  private async validateCreateItemDto(raw: any): Promise<CreateBlocItemDto> {
    const dto = plainToInstance(CreateBlocItemDto, raw);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    if (errors.length) {
      throw new BadRequestException('Item inválido');
    }

    // Validaciones de negocio que no están en el DTO
    if ((dto as any).modo === 'monto' && ((dto as any).monto === undefined || (dto as any).monto === null)) {
      throw new BadRequestException('monto es requerido cuando modo=monto');
    }
    if ((dto as any).modo === 'articulo' && ((dto as any).cantidad === undefined || (dto as any).precioUnitario === undefined)) {
      throw new BadRequestException('cantidad y precioUnitario son requeridos cuando modo=articulo');
    }

    return dto;
  }

  private normalizeCreateItemsBody(body: any): any[] {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.items)) return body.items;
    if (body && typeof body === 'object') return [body];
    return [];
  }

  private normalizeDateOrNull(value?: string): Date | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  private getItemTotal(item: any): Decimal {
    const modo = item.modo ?? 'monto';

    if (modo === 'monto') {
      if (typeof item.monto !== 'number') {
        throw new BadRequestException(`Item ${item.itemId} sin monto`);
      }
      return new Decimal(item.monto);
    }

    if (modo === 'articulo') {
      const cantidad = new Decimal(item.cantidad ?? 0);
      const precio = new Decimal(item.precioUnitario ?? 0);
      return cantidad.mul(precio);
    }

    throw new BadRequestException(`Modo inválido en item ${item.itemId}`);
  }

  private getItemRemaining(item: any): Decimal {
    const total = this.getItemTotal(item);
    const pagado = new Decimal(item.pagadoAcumulado ?? 0);
    const remaining = total.minus(pagado);
    return remaining.isNegative() ? new Decimal(0) : remaining;
  }

  private async resolverTarget(
    userId: string,
    targetType: 'principal' | 'cuenta' | 'subcuenta',
    targetId?: string,
  ): Promise<{ targetCurrency: string; targetIdResolved: string; txBase: Partial<CreateTransactionDto> }> {
    if (targetType === 'principal') {
      const cuenta = (await this.cuentaModel.findOne({ userId, isPrincipal: true }).lean()) as any;
      if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');
      const currency = cuenta.moneda || 'MXN';
      return {
        targetCurrency: currency,
        targetIdResolved: cuenta.id,
        txBase: {
          cuentaId: cuenta.id,
          afectaCuenta: true,
        } as Partial<CreateTransactionDto>,
      };
    }

    if (targetType === 'cuenta') {
      if (!targetId) throw new BadRequestException('targetId es requerido');
      const cuenta = (await this.cuentaModel.findOne({ id: targetId, userId }).lean()) as any;
      if (!cuenta) throw new NotFoundException('Cuenta destino no encontrada');
      const currency = cuenta.moneda || 'MXN';
      return {
        targetCurrency: currency,
        targetIdResolved: targetId,
        txBase: {
          cuentaId: targetId,
          afectaCuenta: true,
        } as Partial<CreateTransactionDto>,
      };
    }

    if (!targetId) throw new BadRequestException('targetId es requerido');
    const sub = (await this.subcuentaModel.findOne({ subCuentaId: targetId, userId }).lean()) as any;
    if (!sub) throw new NotFoundException('Subcuenta destino no encontrada');

    return {
      targetCurrency: sub.moneda,
      targetIdResolved: targetId,
      txBase: {
        subCuentaId: targetId,
        afectaCuenta: !!sub.afectaCuenta,
        cuentaId: sub.cuentaId,
      } as Partial<CreateTransactionDto>,
    };
  }

  async crearBloc(dto: CreateBlocDto, userId: string) {
    const blocId = await generateUniqueId(this.blocModel, 'blocId');

    const creado = await this.blocModel.create({
      blocId,
      userId,
      nombre: dto.nombre,
      descripcion: dto.descripcion ?? null,
      icono: dto.icono ?? null,
      tipo: dto.tipo,
    });

    return creado;
  }

  async listarBlocs(userId: string) {
    return this.blocModel.find({ userId }).sort({ createdAt: -1 }).lean();
  }

  async obtenerBloc(blocId: string, userId: string) {
    const bloc = await this.blocModel.findOne({ blocId, userId }).lean();
    if (!bloc) throw new NotFoundException('Bloc no encontrado');

    const items = await this.itemModel.find({ userId, blocId }).sort({ createdAt: -1 }).lean();

    return {
      bloc,
      items,
    };
  }

  async actualizarBloc(blocId: string, dto: UpdateBlocDto, userId: string) {
    const existing = await this.blocModel.findOne({ blocId, userId });
    if (!existing) throw new NotFoundException('Bloc no encontrado');

    const patch: any = { ...dto };
    Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

    if (!Object.keys(patch).length) {
      return existing;
    }

    const updated = await this.blocModel.findOneAndUpdate(
      { blocId, userId },
      { $set: patch },
      { new: true },
    );

    return updated;
  }

  async crearItem(blocId: string, dto: CreateBlocItemDto, userId: string) {
    const bloc = await this.blocModel.findOne({ blocId, userId }).lean();
    if (!bloc) throw new NotFoundException('Bloc no encontrado');

    if (dto.modo === 'monto' && (dto.monto === undefined || dto.monto === null)) {
      throw new BadRequestException('monto es requerido cuando modo=monto');
    }
    if (dto.modo === 'articulo' && (dto.cantidad === undefined || dto.precioUnitario === undefined)) {
      throw new BadRequestException('cantidad y precioUnitario son requeridos cuando modo=articulo');
    }

    const itemId = await generateUniqueId(this.itemModel, 'itemId');

    const creado = await this.itemModel.create({
      itemId,
      blocId,
      userId,
      categoria: dto.categoria,
      titulo: dto.titulo,
      descripcion: dto.descripcion ?? null,
      moneda: dto.moneda,
      modo: dto.modo,
      monto: dto.modo === 'monto' ? dto.monto : undefined,
      cantidad: dto.modo === 'articulo' ? dto.cantidad : undefined,
      precioUnitario: dto.modo === 'articulo' ? dto.precioUnitario : undefined,
      estado: 'pendiente',
      pagadoAcumulado: 0,
      vencimiento: dto.vencimiento ? new Date(dto.vencimiento) : null,
      adjuntos: dto.adjuntos ?? [],
    });

    return creado;
  }

  /**
   * Crear 1 o N items en una sola petición.
   * Acepta body como:
   * - { ...item }
   * - [{...item}, {...item}]
   * - { items: [{...item}, ...] }
   */
  async crearItems(blocId: string, body: any, userId: string) {
    const bloc = await this.blocModel.findOne({ blocId, userId }).lean();
    if (!bloc) throw new NotFoundException('Bloc no encontrado');

    const rawItems = this.normalizeCreateItemsBody(body);
    if (!rawItems.length) throw new BadRequestException('items es requerido');

    // Si el cliente manda {items:[...]}, intentamos validar ese wrapper también (best-effort)
    if (body && body.items) {
      const wrapper = plainToInstance(CreateBlocItemsDto, body);
      const wrapperErrors = await validate(wrapper, { whitelist: true, forbidNonWhitelisted: false });
      if (wrapperErrors.length) {
        throw new BadRequestException('items inválido');
      }
    }

    const validatedDtos: CreateBlocItemDto[] = [];
    for (const raw of rawItems) {
      validatedDtos.push(await this.validateCreateItemDto(raw));
    }

    const docsToInsert: any[] = [];
    for (const dto of validatedDtos) {
      const itemId = await generateUniqueId(this.itemModel, 'itemId');
      docsToInsert.push({
        itemId,
        blocId,
        userId,
        categoria: dto.categoria,
        titulo: dto.titulo,
        descripcion: dto.descripcion ?? null,
        moneda: dto.moneda,
        modo: dto.modo,
        monto: dto.modo === 'monto' ? (dto as any).monto : undefined,
        cantidad: dto.modo === 'articulo' ? (dto as any).cantidad : undefined,
        precioUnitario: dto.modo === 'articulo' ? (dto as any).precioUnitario : undefined,
        estado: 'pendiente',
        pagadoAcumulado: 0,
        vencimiento: dto.vencimiento ? new Date(dto.vencimiento) : null,
        adjuntos: (dto as any).adjuntos ?? [],
      });
    }

    const created = await this.itemModel.insertMany(docsToInsert, { ordered: true });
    return {
      count: created.length,
      items: created,
    };
  }

  async patchItems(blocId: string, dto: PatchBlocItemsDto, userId: string) {
    const bloc = await this.blocModel.findOne({ blocId, userId }).lean();
    if (!bloc) throw new NotFoundException('Bloc no encontrado');

    const deleteItemIds = (dto.deleteItemIds ?? []).filter(Boolean);
    const upserts = (dto.upserts ?? []).filter(Boolean);

    if (!deleteItemIds.length && !upserts.length) {
      throw new BadRequestException('Nada que aplicar');
    }

    let deletedCount = 0;
    if (deleteItemIds.length) {
      const delRes = await this.itemModel.deleteMany({ userId, blocId, itemId: { $in: deleteItemIds } });
      deletedCount = (delRes as any)?.deletedCount ?? 0;
    }

    const createdItems: any[] = [];
    let updatedCount = 0;

    // 1) Creates (upserts without itemId)
    const creates = upserts.filter((u) => !u.itemId);
    if (creates.length) {
      const docsToInsert: any[] = [];
      for (const raw of creates as UpsertBlocItemDto[]) {
        // Reusar validación estricta de Create
        const validated = await this.validateCreateItemDto(raw);
        const itemId = await generateUniqueId(this.itemModel, 'itemId');
        docsToInsert.push({
          itemId,
          blocId,
          userId,
          categoria: validated.categoria,
          titulo: validated.titulo,
          descripcion: validated.descripcion ?? null,
          moneda: validated.moneda,
          modo: validated.modo,
          monto: validated.modo === 'monto' ? (validated as any).monto : undefined,
          cantidad: validated.modo === 'articulo' ? (validated as any).cantidad : undefined,
          precioUnitario: validated.modo === 'articulo' ? (validated as any).precioUnitario : undefined,
          estado: 'pendiente',
          pagadoAcumulado: 0,
          vencimiento: validated.vencimiento ? new Date(validated.vencimiento) : null,
          adjuntos: (validated as any).adjuntos ?? [],
        });
      }

      const inserted = await this.itemModel.insertMany(docsToInsert, { ordered: true });
      createdItems.push(...inserted);
    }

    // 2) Updates (upserts with itemId)
    const updates = upserts.filter((u) => !!u.itemId);
    if (updates.length) {
      const bulkOps: any[] = [];
      for (const u of updates as UpsertBlocItemDto[]) {
        const itemId = String(u.itemId);

        const patch: any = {};
        if (u.categoria !== undefined) patch.categoria = u.categoria;
        if (u.titulo !== undefined) patch.titulo = u.titulo;
        if (u.descripcion !== undefined) patch.descripcion = u.descripcion;
        if (u.moneda !== undefined) patch.moneda = u.moneda;
        if (u.adjuntos !== undefined) patch.adjuntos = u.adjuntos;

        const unset: any = {};

        if (u.vencimiento !== undefined) {
          patch.vencimiento = this.normalizeDateOrNull(u.vencimiento);
        }

        if (u.modo !== undefined) {
          if (u.modo !== 'monto' && u.modo !== 'articulo') {
            throw new BadRequestException('modo inválido');
          }
          patch.modo = u.modo;

          // Si el cliente cambia modo, exigir campos necesarios
          if (u.modo === 'monto') {
            if (u.monto === undefined || u.monto === null) {
              throw new BadRequestException('monto es requerido cuando modo=monto');
            }
            patch.monto = u.monto;
            unset.cantidad = '';
            unset.precioUnitario = '';
          }
          if (u.modo === 'articulo') {
            if (u.cantidad === undefined || u.precioUnitario === undefined) {
              throw new BadRequestException('cantidad y precioUnitario son requeridos cuando modo=articulo');
            }
            patch.cantidad = u.cantidad;
            patch.precioUnitario = u.precioUnitario;
            unset.monto = '';
          }
        } else {
          // Si no cambia modo, permitir update parcial de los campos numéricos
          if (u.monto !== undefined) patch.monto = u.monto;
          if (u.cantidad !== undefined) patch.cantidad = u.cantidad;
          if (u.precioUnitario !== undefined) patch.precioUnitario = u.precioUnitario;
        }

        // No permitir cambios de estado/pagado por este endpoint (lo controla liquidación)

        if (!Object.keys(patch).length && !Object.keys(unset).length) {
          continue;
        }

        bulkOps.push({
          updateOne: {
            filter: { userId, blocId, itemId },
            update: {
              ...(Object.keys(patch).length ? { $set: patch } : {}),
              ...(Object.keys(unset).length ? { $unset: unset } : {}),
            },
          },
        });
      }

      if (bulkOps.length) {
        const res = await this.itemModel.bulkWrite(bulkOps, { ordered: false });
        updatedCount = (res as any)?.modifiedCount ?? 0;
      }
    }

    return {
      deletedCount,
      updatedCount,
      createdCount: createdItems.length,
      createdItems,
    };
  }

  async actualizarItem(blocId: string, itemId: string, dto: UpdateBlocItemDto, userId: string) {
    const item = await this.itemModel.findOne({ userId, blocId, itemId });
    if (!item) throw new NotFoundException('Item no encontrado');

    const patch: any = { ...dto };
    if (dto.vencimiento) patch.vencimiento = new Date(dto.vencimiento);

    // Si el modo cambia, limpiamos campos no compatibles
    const nextModo = (dto.modo ?? (item as any).modo) as any;
    if (dto.modo && dto.modo !== (item as any).modo) {
      if (nextModo === 'monto') {
        patch.cantidad = undefined;
        patch.precioUnitario = undefined;
      }
      if (nextModo === 'articulo') {
        patch.monto = undefined;
      }
    }

    Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

    const updated = await this.itemModel.findOneAndUpdate(
      { userId, blocId, itemId },
      { $set: patch },
      { new: true },
    );

    return updated;
  }

  private async calcularPreview(params: {
    blocId: string;
    userId: string;
    dto: LiquidarBlocPreviewDto;
  }) {
    const { blocId, userId, dto } = params;

    const bloc = await this.blocModel.findOne({ blocId, userId }).lean();
    if (!bloc) throw new NotFoundException('Bloc no encontrado');

    const itemIds = (dto.itemIds ?? []).filter(Boolean);
    if (!itemIds.length) throw new BadRequestException('itemIds es requerido');

    const items = await this.itemModel
      .find({ userId, blocId, itemId: { $in: itemIds } })
      .lean();

    if (items.length !== itemIds.length) {
      throw new BadRequestException('Uno o más items no existen en este bloc');
    }

    const invalid = items.filter((i: any) => !['pendiente', 'parcial'].includes(i.estado));
    if (invalid.length) {
      throw new BadRequestException('Solo se pueden liquidar items en estado pendiente o parcial');
    }

    const { targetCurrency } = await this.resolverTarget(userId, dto.targetType as any, (dto as any).targetId);

    const partialMap = new Map<string, Decimal>();
    for (const p of dto.partialPayments ?? []) {
      if (!p?.itemId) continue;
      const raw = new Decimal((p as any).amount ?? 0);
      const amount = raw.isFinite() && raw.greaterThan(0) ? raw : new Decimal(0);
      partialMap.set(p.itemId, amount);
    }

    const totalOriginalByCurrency: Record<string, Decimal> = {};
    const resultItems: any[] = [];
    let totalConverted = new Decimal(0);

    for (const item of items as any[]) {
      const remaining = this.getItemRemaining(item);
      const requestedPartial = partialMap.has(item.itemId) ? partialMap.get(item.itemId)! : null;
      const payOriginal = requestedPartial ? Decimal.min(requestedPartial, remaining) : remaining;

      if (payOriginal.lte(0)) continue;

      const currency = item.moneda;
      totalOriginalByCurrency[currency] = (totalOriginalByCurrency[currency] ?? new Decimal(0)).plus(payOriginal);

      let rateUsed = 1;
      let rateAsOf: Date | null = null;

      if (currency !== targetCurrency) {
        const rate = await this.exchangeRateService.getRate(currency, targetCurrency);
        rateUsed = rate.rate;
        rateAsOf = rate.asOf;
      } else {
        rateAsOf = new Date();
      }

      const convertedRaw = payOriginal.mul(new Decimal(rateUsed));
      const convertedRounded = new Decimal(this.toMoney(convertedRaw));
      const roundingDiff = convertedRounded.minus(convertedRaw);

      totalConverted = totalConverted.plus(convertedRounded);

      resultItems.push({
        itemId: item.itemId,
        titulo: item.titulo,
        original: { amount: this.toMoney(payOriginal), currency },
        rateUsed,
        rateAsOf: rateAsOf ? rateAsOf.toISOString() : null,
        converted: { amount: convertedRounded.toNumber(), currency: targetCurrency },
        roundingDiff: this.toMoney(roundingDiff),
      });
    }

    const totalOriginalByCurrencyOut: Record<string, number> = {};
    for (const [k, v] of Object.entries(totalOriginalByCurrency)) {
      totalOriginalByCurrencyOut[k] = this.toMoney(v);
    }

    if (resultItems.length === 0) {
      throw new BadRequestException('Nada para liquidar (montos en 0 o ya pagados)');
    }

    return {
      bloc: { blocId: bloc.blocId, nombre: bloc.nombre, tipo: bloc.tipo },
      targetCurrency,
      totalOriginalByCurrency: totalOriginalByCurrencyOut,
      totalConverted: this.toMoney(totalConverted),
      items: resultItems,
    };
  }

  async previewLiquidacion(blocId: string, dto: LiquidarBlocPreviewDto, userId: string) {
    return this.calcularPreview({ blocId, userId, dto });
  }

  async liquidar(blocId: string, dto: LiquidarBlocDto, userId: string, idempotencyKeyHeader?: string) {
    const idempotencyKey = (idempotencyKeyHeader ?? dto.idempotencyKey ?? '').trim() || undefined;

    if (idempotencyKey) {
      const existing = await this.liquidationModel.findOne({ userId, idempotencyKey }).lean();
      if (existing) {
        return {
          liquidationId: existing.liquidationId,
          status: existing.status,
          targetCurrency: existing.targetCurrency,
          totalOriginalByCurrency: existing.totals?.totalOriginalByCurrency ?? {},
          totalConverted: existing.totals?.totalConverted ?? 0,
          items: (existing.items ?? []).map((it: any) => ({
            itemId: it.itemId,
            original: { amount: it.montoOriginalPagado, currency: it.monedaOriginal },
            rateUsed: it.rateUsed ?? 1,
            rateAsOf: it.rateAsOf ? new Date(it.rateAsOf).toISOString() : null,
            converted: { amount: it.convertedAmount, currency: it.monedaDestino },
            roundingDiff: it.roundingDiff ?? 0,
          })),
          transactionIds: existing.createdTransactionIds ?? [],
          note: existing.note ?? null,
        };
      }
    }

    // Reutilizamos la lógica de preview para calcular importes y tasas
    const preview = await this.calcularPreview({ blocId, userId, dto });

    const { targetCurrency } = preview;
    const { txBase, targetIdResolved } = await this.resolverTarget(userId, dto.targetType as any, (dto as any).targetId);

    const liquidationId = await generateUniqueId(this.liquidationModel, 'liquidationId');

    const liquidationItemsSnapshot = (preview.items ?? []).map((it: any) => ({
      itemId: it.itemId,
      monedaOriginal: it.original.currency,
      montoOriginalPagado: it.original.amount,
      rateUsed: it.rateUsed,
      rateAsOf: it.rateAsOf ? new Date(it.rateAsOf) : null,
      convertedAmount: it.converted.amount,
      monedaDestino: it.converted.currency,
      roundingDiff: it.roundingDiff,
    }));

    const recordPayload: any = {
      liquidationId,
      userId,
      blocId,
      targetType: dto.targetType,
      targetId: targetIdResolved,
      targetCurrency,
      items: liquidationItemsSnapshot,
      totals: {
        totalOriginalByCurrency: preview.totalOriginalByCurrency,
        totalConverted: preview.totalConverted,
      },
      createdTransactionIds: [],
      status: 'processing',
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(dto.nota ? { note: dto.nota } : {}),
    };

    const record = await this.liquidationModel.create(recordPayload);

    try {
      const porItem = !!dto.porItem;
      const createdTransactionIds: string[] = [];

      if (porItem) {
        for (const it of preview.items as any[]) {
          const txDto: CreateTransactionDto = {
            tipo: 'egreso',
            monto: it.converted.amount,
            moneda: targetCurrency,
            concepto: it.titulo ?? it.itemId,
            motivo: `Liquidación bloc ${preview.bloc.nombre}${dto.nota ? ` - ${dto.nota}` : ''}`,
            afectaCuenta: (txBase as any).afectaCuenta as boolean,
            cuentaId: (txBase as any).cuentaId,
            subCuentaId: (txBase as any).subCuentaId,
          };

          const created = await this.transactionsService.crear(txDto, userId);
          const transaccionId = created?.transaccion?.transaccionId;
          if (transaccionId) createdTransactionIds.push(transaccionId);

          await this.itemModel.findOneAndUpdate(
            { userId, blocId, itemId: it.itemId },
            {
              $set: {
                lastLiquidationId: liquidationId,
                lastTransactionId: transaccionId ?? null,
              },
            },
          );
        }
      } else {
        const txDto: CreateTransactionDto = {
          tipo: 'egreso',
          monto: preview.totalConverted,
          moneda: targetCurrency,
          concepto: `Bloc: ${preview.bloc.nombre}`,
          motivo: `Liquidación (${(preview.items ?? []).length} items)${dto.nota ? ` - ${dto.nota}` : ''}`,
          afectaCuenta: (txBase as any).afectaCuenta as boolean,
          cuentaId: (txBase as any).cuentaId,
          subCuentaId: (txBase as any).subCuentaId,
        };

        const created = await this.transactionsService.crear(txDto, userId);
        const transaccionId = created?.transaccion?.transaccionId;
        if (transaccionId) createdTransactionIds.push(transaccionId);

        await this.itemModel.updateMany(
          { userId, blocId, itemId: { $in: (preview.items ?? []).map((x: any) => x.itemId) } },
          {
            $set: {
              lastLiquidationId: liquidationId,
              lastTransactionId: transaccionId ?? null,
            },
          },
        );
      }

      // Actualizar estado/pagadoAcumulado
      const itemsDb = await this.itemModel
        .find({ userId, blocId, itemId: { $in: (preview.items ?? []).map((x: any) => x.itemId) } })
        .lean();

      const payMap = new Map<string, Decimal>();
      for (const it of preview.items as any[]) {
        payMap.set(it.itemId, new Decimal(it.original.amount));
      }

      const bulkOps: any[] = [];
      for (const item of itemsDb as any[]) {
        const pay = payMap.get(item.itemId) ?? new Decimal(0);
        const total = this.getItemTotal(item);
        const nextPagado = new Decimal(item.pagadoAcumulado ?? 0).plus(pay);
        const remaining = total.minus(nextPagado);

        const nextEstado = remaining.lte(0.000001) ? 'pagado' : 'parcial';

        bulkOps.push({
          updateOne: {
            filter: { userId, blocId, itemId: item.itemId },
            update: {
              $set: {
                pagadoAcumulado: this.toMoney(nextPagado),
                estado: nextEstado,
              },
            },
          },
        });
      }

      if (bulkOps.length) {
        await this.itemModel.bulkWrite(bulkOps);
      }

      await this.liquidationModel.findOneAndUpdate(
        { _id: (record as any)._id, userId },
        {
          $set: {
            status: 'done',
            createdTransactionIds,
          },
        },
      );

      return {
        liquidationId,
        targetCurrency,
        totalOriginalByCurrency: preview.totalOriginalByCurrency,
        totalConverted: preview.totalConverted,
        items: preview.items,
        transactionIds: createdTransactionIds,
      };
    } catch (error: any) {
      await this.liquidationModel.findOneAndUpdate(
        { _id: (record as any)._id, userId },
        {
          $set: {
            status: 'failed',
            error: {
              message: error?.message ?? 'Error',
              name: error?.name ?? null,
            },
          },
        },
      );

      throw error;
    }
  }

  async listarLiquidaciones(blocId: string, userId: string) {
    const bloc = await this.blocModel.findOne({ blocId, userId }).lean();
    if (!bloc) throw new NotFoundException('Bloc no encontrado');

    return this.liquidationModel.find({ userId, blocId }).sort({ createdAt: -1 }).lean();
  }
}
