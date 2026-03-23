import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import { Cuenta, CuentaDocument } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaDocument } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { Meta, MetaDocument } from '../goals/schemas/meta.schema';
import { Recurrente, RecurrenteDocument } from '../recurrentes/schemas/recurrente.schema';
import { Transaction, TransactionDocument } from '../transactions/schemas/transaction.schema/transaction.schema';
import { PlanConfigService } from '../plan-config/plan-config.service';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';
import { SharedSpaceMember, SharedSpaceMemberDocument } from '../shared/schemas/shared-space-member.schema';
import { SharedSpace, SharedSpaceDocument } from '../shared/schemas/shared-space.schema';
import { SharedInvitation, SharedInvitationDocument } from '../shared/schemas/shared-invitation.schema';
import { SharedNotification, SharedNotificationDocument } from '../shared/schemas/shared-notification.schema';
import { SharedMovement, SharedMovementDocument } from '../shared/schemas/shared-movement.schema';

type SnapshotRange = 'day' | 'week' | 'month' | '3months' | '6months' | 'year' | 'all';

type BalancePeriodo = 'dia' | 'semana' | 'mes' | '3meses' | '6meses' | 'año';

type BalanceCardOptions = {
  periodo?: BalancePeriodo;
  moneda?: string;
};

type SnapshotOptions = {
  range?: SnapshotRange;
  fechaInicio?: string;
  fechaFin?: string;
  tipoTransaccion?: 'ingreso' | 'egreso' | 'ambos';
  moneda?: string;
  recentLimit?: number;
  recentPage?: number;
  subaccountsLimit?: number;
  subaccountsPage?: number;
  metasLimit?: number;
  metasPage?: number;
  recurrentesLimit?: number;
  recurrentesPage?: number;
  /** Número de movimientos recientes por espacio en el mini-feed (default 3, máx 10) */
  sharedMovementsLimit?: number;
};

type Cached = {
  expiresAt: number;
  data: any;
};

@Injectable()
export class DashboardService {
  private readonly microCache = new Map<string, Cached>();
  private readonly microCacheTtlMs = 3_000;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
    @InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<SubcuentaDocument>,
    @InjectModel(Meta.name) private readonly metaModel: Model<MetaDocument>,
    @InjectModel(Recurrente.name) private readonly recurrenteModel: Model<RecurrenteDocument>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    private readonly planConfigService: PlanConfigService,
    private readonly cuentaHistorialService: CuentaHistorialService,
    @InjectModel(SharedSpaceMember.name) private readonly sharedMemberModel: Model<SharedSpaceMemberDocument>,
    @InjectModel(SharedSpace.name) private readonly sharedSpaceModel: Model<SharedSpaceDocument>,
    @InjectModel(SharedInvitation.name) private readonly sharedInvitationModel: Model<SharedInvitationDocument>,
    @InjectModel(SharedNotification.name) private readonly sharedNotificationModel: Model<SharedNotificationDocument>,
    @InjectModel(SharedMovement.name) private readonly sharedMovementModel: Model<SharedMovementDocument>,
  ) {}

  async getDashboardVersion(userId: string): Promise<string> {
    const u = await this.userModel
      .findOne({ id: userId })
      .select('dashboardVersion')
      .lean();

    const versionNum = Number((u as any)?.dashboardVersion ?? 0);
    return String(versionNum);
  }

  private resolveRange(opts?: SnapshotOptions): { range: SnapshotRange; start: Date; end: Date; isCustom: boolean } {
    const parseDateInput = (value: string, isEnd: boolean): Date => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(isEnd ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
      }
      return new Date(value);
    };

    const now = new Date();
    const defaultRange: SnapshotRange = opts?.range ?? 'month';

    // Si vienen fechas explícitas, siempre usarlas (ignorando el range)
    if (opts?.fechaInicio && opts?.fechaFin) {
      const start = parseDateInput(opts.fechaInicio, false);
      const end = parseDateInput(opts.fechaFin, true);
      if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start.getTime() <= end.getTime()) {
        return { range: defaultRange, start, end, isCustom: true };
      }
    }

    const end = new Date(now);
    const r: SnapshotRange = defaultRange;

    const start = new Date(now);
    if (r === 'day') {
      start.setDate(start.getDate() - 1);
    } else if (r === 'week') {
      start.setDate(start.getDate() - 7);
    } else if (r === 'all') {
      // Desde siempre: usar un inicio muy temprano (evita depender de createdAt del usuario)
      return { range: r, start: new Date('2000-01-01T00:00:00.000Z'), end, isCustom: false };
    } else if (r === '3months') {
      start.setMonth(start.getMonth() - 3);
    } else if (r === '6months') {
      start.setMonth(start.getMonth() - 6);
    } else if (r === 'year') {
      start.setFullYear(start.getFullYear() - 1);
    } else {
      start.setMonth(start.getMonth() - 1);
    }

    return { range: r, start, end, isCustom: false };
  }

  private resolveBalancePeriodo(periodo?: BalancePeriodo): SnapshotRange {
    const p = periodo ?? 'mes';
    if (p === 'dia') return 'day';
    if (p === 'semana') return 'week';
    if (p === 'mes') return 'month';
    if (p === '3meses') return '3months';
    if (p === '6meses') return '6months';
    return 'year';
  }

  private buildBalancePeriodLabels() {
    return {
      dia: 'Día',
      semana: 'Semana',
      mes: 'Mes',
      '3meses': '3 Meses',
      '6meses': '6 Meses',
      año: 'Año',
    } as const;
  }

  private async aggregatePeriodTotals(params: {
    userId: string;
    start: Date;
    end: Date;
    tipoTransaccion?: 'ingreso' | 'egreso' | 'ambos';
    moneda?: string;
  }) {
    const tipo = params.tipoTransaccion ?? 'ambos';
    const moneda = (params.moneda ?? '').trim();
    const tipoMatch = tipo !== 'ambos' ? { tipo } : {};

    const monedaClause = moneda ? { $or: [{ moneda }, { monedaConvertida: moneda }] } : null;
    const dateClause = {
      $or: [
        { fecha: { $gte: params.start, $lte: params.end } },
        { fecha: { $exists: false }, createdAt: { $gte: params.start, $lte: params.end } },
      ],
    };
    const andMatch = monedaClause ? { $and: [dateClause, monedaClause] } : dateClause;

    const rows = await this.transactionModel
      .aggregate([
        {
          $match: {
            userId: params.userId,
            ...tipoMatch,
            ...andMatch,
          },
        },
        {
          $project: {
            tipo: 1,
            amount: { $abs: { $ifNull: ['$montoConvertido', '$monto'] } },
          },
        },
        {
          $group: {
            _id: '$tipo',
            total: { $sum: '$amount' },
          },
        },
      ])
      .exec();

    const ingresos = Number((rows ?? []).find((x: any) => x._id === 'ingreso')?.total ?? 0);
    const egresos = Number((rows ?? []).find((x: any) => x._id === 'egreso')?.total ?? 0);

    return { ingresos, egresos };
  }

  async getSnapshot(userId: string, version: string, opts?: SnapshotOptions) {
    const { range, start, end, isCustom } = this.resolveRange(opts);

    const chartGranularity: 'hour' | 'day' | 'month' =
      range === 'day' ? 'hour' : range === 'year' || range === 'all' ? 'month' : 'day';

    const chartDateFormat =
      chartGranularity === 'hour'
        ? '%Y-%m-%dT%H:00'
        : chartGranularity === 'month'
          ? '%Y-%m'
          : '%Y-%m-%d';

    const chartMaxPoints =
      chartGranularity === 'hour'
        ? 48
        : chartGranularity === 'month'
          ? range === 'all'
            ? 240
            : 24
          : range === '6months'
            ? 250
            : range === '3months'
              ? 120
              : range === 'month'
                ? 60
                : 30;

    const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      const i = Math.trunc(n);
      return Math.min(max, Math.max(min, i));
    };

    // Movimientos (transacciones)
    const requestedRecentLimit = Number(opts?.recentLimit);
    const recentLimitBase = Number.isFinite(requestedRecentLimit) ? requestedRecentLimit : 20;
    const recentLimit = Math.min(20, Math.max(10, Math.trunc(recentLimitBase)));
    const recentPage = clampInt(opts?.recentPage, 1, 1, 10_000);
    const recentSkip = (recentPage - 1) * recentLimit;

    // Subcuentas
    const subaccountsLimit = clampInt(opts?.subaccountsLimit, 50, 10, 50);
    const subaccountsPage = clampInt(opts?.subaccountsPage, 1, 1, 10_000);
    const subaccountsSkip = (subaccountsPage - 1) * subaccountsLimit;

    // Metas
    const metasLimit = clampInt(opts?.metasLimit, 20, 1, 200);
    const metasPage = clampInt(opts?.metasPage, 1, 1, 10_000);
    const metasSkip = (metasPage - 1) * metasLimit;

    // Recurrentes
    const recurrentesLimit = clampInt(opts?.recurrentesLimit, 50, 10, 50);
    const recurrentesPage = clampInt(opts?.recurrentesPage, 1, 1, 10_000);
    const recurrentesSkip = (recurrentesPage - 1) * recurrentesLimit;

    const tipo = opts?.tipoTransaccion ?? 'ambos';
    const moneda = (opts?.moneda ?? '').trim();
    const customKey = isCustom ? `${opts?.fechaInicio ?? ''}_${opts?.fechaFin ?? ''}` : '';
    const cacheKey = `${userId}:${version}:${range}:${customKey}:tipo:${tipo}:moneda:${moneda}:tx:${recentLimit}:${recentPage}:sub:${subaccountsLimit}:${subaccountsPage}:rec:${recurrentesLimit}:${recurrentesPage}`;
    const cached = this.microCache.get(cacheKey);
    const nowMs = Date.now();
    if (cached && nowMs < cached.expiresAt) {
      return cached.data;
    }

    const user = await this.userModel
      .findOne({ id: userId })
      .select('id nombreCompleto planType isPremium monedaPrincipal monedaPreferencia monedasFavoritas dashboardVersion')
      .lean();

    const planType = (user as any)?.planType ?? 'free_plan';
    const isPremium = !!(user as any)?.isPremium;

    const planConfig = await this.planConfigService.findByPlanType(planType);

    const toLimitValue = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const toLimitItem = (key: string, label: string, value: unknown) => {
      const limit = toLimitValue(value);
      const unlimited = limit === -1;
      return {
        key,
        label,
        limit,
        unlimited,
      };
    };

    const tipoMatch = tipo !== 'ambos' ? { tipo } : {};
    const monedaClause = moneda ? { $or: [{ moneda }, { monedaConvertida: moneda }] } : null;
    const dateClause = {
      $or: [
        { fecha: { $gte: start, $lte: end } },
        { fecha: { $exists: false }, createdAt: { $gte: start, $lte: end } },
      ],
    };
    const andMatch = monedaClause ? { $and: [dateClause, monedaClause] } : dateClause;

    const [
      cuenta,
      subcuentas,
      metas,
      metasTotalCount,
      subcuentasTotalCount,
      recurrentes,
      recurrentesTotalCount,
      recentTransactions,
      periodAgg,
      chartPoints,
      subcuentasTotalsAgg,
      recurrentesTotalsAgg,
      sharedData,
      conceptoBreakdownAgg,
    ] = await Promise.all([
      this.cuentaModel
        .findOne({ userId, isPrincipal: true })
        .select('id moneda cantidad simbolo color nombre')
        .lean(),

      this.subcuentaModel
        .find({ userId })
        .select('subCuentaId nombre cantidad moneda simbolo color activa pausadaPorPlan')
        .sort({ createdAt: -1 })
        .skip(subaccountsSkip)
        .limit(subaccountsLimit)
        .lean(),

      this.metaModel
        .find({ userId })
        .select('metaId nombre objetivo moneda estado saldo subcuentaId prioridad updatedAt')
        .sort({ updatedAt: -1 })
        .skip(metasSkip)
        .limit(metasLimit)
        .lean(),

      this.metaModel.countDocuments({ userId }),

      this.subcuentaModel.countDocuments({ userId }),

      this.recurrenteModel
        .find({ userId })
        .select(
          'recurrenteId nombre monto moneda frecuenciaTipo frecuenciaValor proximaEjecucion pausado pausadoPorPlan estado plataforma',
        )
        .sort({ createdAt: -1 })
        .skip(recurrentesSkip)
        .limit(recurrentesLimit)
        .lean(),

      this.recurrenteModel.countDocuments({ userId }),

      this.transactionModel
        .find({ userId })
        .select('transaccionId tipo monto montoConvertido moneda monedaConvertida concepto cuentaId subCuentaId fecha registradoEn createdAt')
        .sort({ fecha: -1, createdAt: -1 })
        .skip(recentSkip)
        .limit(recentLimit)
        .lean(),

      this.aggregatePeriodTotals({ userId, start, end, tipoTransaccion: tipo, moneda }),

      this.transactionModel
        .aggregate([
          {
            $match: {
              userId,
              ...tipoMatch,
              ...andMatch,
            },
          },
          {
            $project: {
              tipo: 1,
              amount: { $abs: { $ifNull: ['$montoConvertido', '$monto'] } },
              effectiveDate: { $ifNull: ['$fecha', '$createdAt'] },
              bucket: {
                $dateToString: { format: chartDateFormat, date: { $ifNull: ['$fecha', '$createdAt'] } },
              },
            },
          },
          {
            $group: {
              _id: '$bucket',
              ingreso: {
                $sum: {
                  $cond: [{ $eq: ['$tipo', 'ingreso'] }, '$amount', 0],
                },
              },
              egreso: {
                $sum: {
                  $cond: [{ $eq: ['$tipo', 'egreso'] }, '$amount', 0],
                },
              },
            },
          },
          // Si hay límite de puntos, conservar los más recientes
          { $sort: { _id: -1 } },
          { $limit: chartMaxPoints },
          { $sort: { _id: 1 } },
        ])
        .exec(),

      // Totales de subcuentas (para toda la cuenta, no paginado)
      this.subcuentaModel
        .aggregate([
          {
            $match: {
              userId,
            },
          },
          {
            $project: {
              moneda: 1,
              cantidad: 1,
              activa: { $ifNull: ['$activa', true] },
              pausadaPorPlan: { $ifNull: ['$pausadaPorPlan', false] },
            },
          },
          {
            $addFields: {
              bucket: {
                $cond: [
                  { $eq: ['$pausadaPorPlan', true] },
                  'paused',
                  {
                    $cond: [{ $eq: ['$activa', true] }, 'active', 'inactive'],
                  },
                ],
              },
            },
          },
          // Solo buckets solicitados: active y paused
          {
            $match: {
              bucket: { $in: ['active', 'paused'] },
            },
          },
          {
            $group: {
              _id: { bucket: '$bucket', moneda: '$moneda' },
              total: { $sum: '$cantidad' },
              count: { $sum: 1 },
            },
          },
          { $sort: { '_id.bucket': 1, '_id.moneda': 1 } },
        ])
        .exec(),

      // Totales de recurrentes (para todo el usuario, no paginado)
      this.recurrenteModel
        .aggregate([
          {
            $match: {
              userId,
            },
          },
          {
            $project: {
              moneda: 1,
              monto: 1,
              pausado: { $ifNull: ['$pausado', false] },
              pausadoPorPlan: { $ifNull: ['$pausadoPorPlan', false] },
            },
          },
          {
            $addFields: {
              bucket: {
                $cond: [{ $or: ['$pausado', '$pausadoPorPlan'] }, 'paused', 'active'],
              },
            },
          },
          {
            $group: {
              _id: { bucket: '$bucket', moneda: '$moneda' },
              total: { $sum: '$monto' },
              count: { $sum: 1 },
            },
          },
          { $sort: { '_id.bucket': 1, '_id.moneda': 1 } },
        ])
        .exec(),

      this.getSharedSpacesSummary(userId, start, end, Math.min(opts?.sharedMovementsLimit ?? 3, 10)),

      // Breakdown de gastos e ingresos por concepto en el rango seleccionado
      this.transactionModel
        .aggregate([
          {
            $match: {
              userId,
              ...andMatch,
            },
          },
          {
            $group: {
              _id: { concepto: '$concepto', tipo: '$tipo' },
              total: { $sum: { $abs: { $ifNull: ['$montoConvertido', '$monto'] } } },
              maxPrecio: { $max: { $abs: { $ifNull: ['$montoConvertido', '$monto'] } } },
              count: { $sum: 1 },
            },
          },
          { $sort: { total: -1 } },
        ])
        .exec(),
    ]);

    // Enforzar (en respuesta) qué recursos deben considerarse pausados por plan.
    // Nota: esto no hace update en DB; solo devuelve flags e IDs para UI.
    const resolvePlanLimit = (raw: unknown, fallback: number) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) return fallback;
      if (n === -1) return Infinity;
      if (n <= 0) return fallback;
      return n;
    };

    const planSubLimit = resolvePlanLimit((planConfig as any)?.subcuentasPorUsuario, 5);
    const planRecLimit = resolvePlanLimit((planConfig as any)?.recurrentesPorUsuario, 10);

    const subcuentasCount = Number(subcuentasTotalCount ?? 0);
    const recurrentesCount = Number(recurrentesTotalCount ?? 0);

    const subcuentasToPauseOnPage: string[] = [];
    const recurrentesToPauseOnPage: string[] = [];

    const subcuentasWithPause = (subcuentas ?? []).map((s: any, localIndex: number) => {
      const globalIndex = subaccountsSkip + localIndex;
      const shouldBePaused = planSubLimit !== Infinity && subcuentasCount > planSubLimit && globalIndex >= planSubLimit;
      if (shouldBePaused) subcuentasToPauseOnPage.push(String(s.subCuentaId));
      return {
        ...s,
        pausadaPorPlan: shouldBePaused || !!s.pausadaPorPlan,
      };
    });

    const recurrentesWithPause = (recurrentes ?? []).map((r: any, localIndex: number) => {
      const globalIndex = recurrentesSkip + localIndex;
      const shouldBePaused = planRecLimit !== Infinity && recurrentesCount > planRecLimit && globalIndex >= planRecLimit;
      if (shouldBePaused) recurrentesToPauseOnPage.push(String(r.recurrenteId));
      return {
        ...r,
        pausadoPorPlan: shouldBePaused || !!r.pausadoPorPlan,
      };
    });

    const buildTotals = (rows: any[]) => {
      const activeByCurrency: Array<{ moneda: string; total: number; count: number }> = [];
      const pausedByCurrency: Array<{ moneda: string; total: number; count: number }> = [];
      for (const r of rows ?? []) {
        const bucket = String(r?._id?.bucket ?? '');
        const moneda = String(r?._id?.moneda ?? '');
        const item = {
          moneda,
          total: Number(r?.total ?? 0),
          count: Number(r?.count ?? 0),
        };
        if (bucket === 'active') activeByCurrency.push(item);
        if (bucket === 'paused') pausedByCurrency.push(item);
      }
      const sumTotal = (arr: Array<{ total: number }>) => arr.reduce((s, x) => s + Number(x.total ?? 0), 0);
      const sumCount = (arr: Array<{ count: number }>) => arr.reduce((s, x) => s + Number(x.count ?? 0), 0);
      return {
        active: {
          total: sumTotal(activeByCurrency),
          count: sumCount(activeByCurrency),
          byCurrency: activeByCurrency,
        },
        paused: {
          total: sumTotal(pausedByCurrency),
          count: sumCount(pausedByCurrency),
          byCurrency: pausedByCurrency,
        },
      };
    };

    const subaccountsTotals = buildTotals(subcuentasTotalsAgg as any);
    const recurrentesTotals = buildTotals(recurrentesTotalsAgg as any);

    // Map metas: compute progreso y saldoActual (legacy metas resolve via subcuenta)
    const metasWithInfo = (metas ?? []).map((m: any) => {
      const objetivo = Number(m.objetivo ?? 0);
      const saldo = Number(m.saldo ?? 0);
      const isLegacy = !!m.subcuentaId;
      const progreso = objetivo > 0 ? Math.min(1, saldo / objetivo) : 0;
      return {
        id: m.metaId,
        nombre: m.nombre,
        moneda: m.moneda,
        estado: m.estado,
        saldo: m.saldo ?? 0,
        objetivo,
        progreso,
        legacySubcuentaId: m.subcuentaId ?? null,
        prioridad: m.prioridad ?? 0,
        updatedAt: m.updatedAt,
        mode: isLegacy ? 'legacy' : 'independent',
      };
    });

    const recentHistory = cuenta?.id
      ? await this.cuentaHistorialService.buscarHistorial(String(cuenta.id), recentPage, recentLimit)
      : { total: 0, page: recentPage, limit: recentLimit, data: [] };

    const ingresosPeriodo = Number((periodAgg as any)?.ingresos ?? 0);
    const egresosPeriodo = Number((periodAgg as any)?.egresos ?? 0);

    const snapshot = {
      meta: {
        version,
        generatedAt: new Date().toISOString(),
        plan: { type: planType, isPremium },
        planEnforcement: {
          subcuentas: {
            limit: planSubLimit === Infinity ? -1 : planSubLimit,
            total: subcuentasCount,
            overLimit: planSubLimit !== Infinity && subcuentasCount > planSubLimit,
            toPauseOnThisPage: subcuentasToPauseOnPage,
          },
          recurrentes: {
            limit: planRecLimit === Infinity ? -1 : planRecLimit,
            total: recurrentesCount,
            overLimit: planRecLimit !== Infinity && recurrentesCount > planRecLimit,
            toPauseOnThisPage: recurrentesToPauseOnPage,
          },
        },
        limits: {
          maxSubcuentas: planConfig?.subcuentasPorUsuario ?? null,
          maxRecurrentes: planConfig?.recurrentesPorUsuario ?? null,
          transaccionesPorDia: planConfig?.transaccionesPorDia ?? null,
          historicoLimitadoDias: planConfig?.historicoLimitadoDias ?? null,
        },
        limitsV2: {
          planType,
          updatedAt: (planConfig as any)?.updatedAt ? new Date((planConfig as any).updatedAt).toISOString() : null,
          items: [
            toLimitItem('subcuentas', 'Subcuentas', planConfig?.subcuentasPorUsuario),
            toLimitItem('recurrentes', 'Recurrentes', planConfig?.recurrentesPorUsuario),
            toLimitItem('transaccionesPorDia', 'Transacciones por día', planConfig?.transaccionesPorDia),
            toLimitItem('historicoLimitadoDias', 'Histórico (días)', planConfig?.historicoLimitadoDias),
          ],
        },
        ranges: {
          selected: range,
          available: [
            { key: 'day', label: 'Día' },
            { key: 'week', label: 'Semana' },
            { key: 'month', label: 'Mes' },
            { key: '3months', label: '3 meses' },
            { key: '6months', label: '6 meses' },
            { key: 'year', label: 'Año' },
            { key: 'all', label: 'Desde siempre' },
          ],
        },
        query: {
          tipoTransaccion: tipo,
          moneda: moneda || null,
          fechaInicio: opts?.fechaInicio ?? null,
          fechaFin: opts?.fechaFin ?? null,
        },
      },
      viewer: {
        id: (user as any)?.id ?? userId,
        nombreCompleto: (user as any)?.nombreCompleto ?? null,
        monedaPrincipal: (user as any)?.monedaPrincipal ?? null,
        monedaPreferencia: (user as any)?.monedaPreferencia ?? null,
        monedasFavoritas: Array.isArray((user as any)?.monedasFavoritas) ? (user as any).monedasFavoritas : [],
      },
      accountSummary: {
        cuentaId: cuenta?.id ?? null,
        moneda: cuenta?.moneda ?? (user as any)?.monedaPreferencia ?? (user as any)?.monedaPrincipal ?? 'MXN',
        saldo: cuenta?.cantidad ?? 0,
        ingresosPeriodo,
        egresosPeriodo,
      },
      subaccountsSummary: (subcuentasWithPause ?? []).map((s: any) => ({
        id: s.subCuentaId,
        nombre: s.nombre,
        saldo: s.cantidad,
        moneda: s.moneda,
        activa: s.activa,
        pausadaPorPlan: !!s.pausadaPorPlan,
        color: s.color ?? null,
        simbolo: s.simbolo ?? null,
      })),
      subaccountsTotals,
      recurrentesSummary: (recurrentesWithPause ?? []).map((r: any) => ({
        id: r.recurrenteId,
        nombre: r.nombre,
        color: r?.plataforma?.color ?? null,
        categoria: r?.plataforma?.categoria ?? null,
        monto: r.monto,
        moneda: r.moneda,
        frecuenciaTipo: r.frecuenciaTipo ?? null,
        frecuenciaValor: r.frecuenciaValor,
        nextRun: r.proximaEjecucion,
        estado: r.estado,
        pausado: !!r.pausado,
        pausadoPorPlan: !!r.pausadoPorPlan,
      })),
      recurrentesTotals,
      recentTransactions: (recentTransactions ?? []).map((t: any) => ({
        // Fecha efectiva vs fecha de registro
        fechaEfectiva: (t.fecha ?? t.createdAt) ?? null,
        registradoEn: (t.registradoEn ?? t.createdAt) ?? null,
        isBackdated: !!(t.fecha && t.registradoEn && String(new Date(t.fecha).toISOString()).slice(0, 10) !== String(new Date(t.registradoEn).toISOString()).slice(0, 10)),
        id: t.transaccionId,
        tipo: t.tipo,
        monto: t.monto,
        montoConvertido: t.montoConvertido ?? null,
        moneda: t.moneda,
        monedaConvertida: t.monedaConvertida ?? null,
        concepto: t.concepto,
        cuentaId: t.cuentaId ?? null,
        subCuentaId: t.subCuentaId ?? null,
        createdAt: t.createdAt,
      })),
      recentHistory: {
        total: recentHistory.total,
        page: recentHistory.page,
        limit: recentHistory.limit,
        data: (recentHistory.data ?? []).map((h: any) => ({
          id: h.id ?? String(h._id ?? ''),
          tipo: h.tipo,
          descripcion: h.descripcion,
          monto: h.monto,
          fecha: h.fecha,
          motivo: h.motivo ?? null,
          subcuentaId: h.subcuentaId ?? null,
          conceptoId: h.conceptoId ?? null,
          detalles: h.detalles ?? null,
          metadata: h.metadata ?? null,
        })),
      },
      metasSummary: {
        total: Number(metasTotalCount ?? 0),
        page: metasPage,
        limit: metasLimit,
        data: metasWithInfo,
      },
      chartAggregates: {
        range,
        granularity: chartGranularity,
        start: start.toISOString(),
        end: end.toISOString(),
        points: (chartPoints ?? []).map((p: any) => ({
          x: p._id,
          in: p.ingreso,
          out: -Math.abs(p.egreso),
        })),
      },
      sharedSpacesSummary: sharedData,
      conceptoBreakdown: (() => {
        // Build two maps: egresos and ingresos, keyed by concepto
        const egresoMap: Record<string, { total: number; maxPrecio: number; count: number }> = {};
        const ingresoMap: Record<string, { total: number; maxPrecio: number; count: number }> = {};
        for (const row of (conceptoBreakdownAgg as any[]) ?? []) {
          const concepto = String(row?._id?.concepto ?? 'Sin concepto').trim() || 'Sin concepto';
          const tipo = String(row?._id?.tipo ?? '');
          const entry = { total: Number(row?.total ?? 0), maxPrecio: Number(row?.maxPrecio ?? 0), count: Number(row?.count ?? 0) };
          if (tipo === 'egreso') egresoMap[concepto] = entry;
          else if (tipo === 'ingreso') ingresoMap[concepto] = entry;
        }
        const toSortedArray = (map: Record<string, { total: number; maxPrecio: number; count: number }>) =>
          Object.entries(map)
            .map(([concepto, v]) => ({ concepto, ...v }))
            .sort((a, b) => b.total - a.total);
        const egresos = toSortedArray(egresoMap);
        const ingresos = toSortedArray(ingresoMap);
        return {
          egresos,
          ingresos,
          totalEgresos: egresos.reduce((s, e) => s + e.total, 0),
          totalIngresos: ingresos.reduce((s, e) => s + e.total, 0),
        };
      })(),
    };

    this.microCache.set(cacheKey, { expiresAt: nowMs + this.microCacheTtlMs, data: snapshot });
    return snapshot;
  }

  private async getSharedSpacesSummary(userId: string, start: Date, end: Date, movementsLimit = 3) {
    const empty = {
      activeSpacesCount: 0,
      pendingInvitationsCount: 0,
      unreadNotificationsCount: 0,
      spaces: [],
    };

    // 1. Membresías activas del usuario (incluye su rol en cada espacio)
    const memberDocs = await this.sharedMemberModel
      .find({ userId, estado: 'active' })
      .select('spaceId rol')
      .lean();

    const spaceIds = memberDocs.map((m: any) => String(m.spaceId));
    const myRolMap = new Map((memberDocs as any[]).map((m) => [String(m.spaceId), String(m.rol)]));

    if (spaceIds.length === 0) {
      const [pendingInvitationsCount, unreadNotificationsCount] = await Promise.all([
        this.sharedInvitationModel.countDocuments({ invitedUserId: userId, estado: 'pending' }),
        this.sharedNotificationModel.countDocuments({ userId, read: false }),
      ]);
      return { ...empty, pendingInvitationsCount, unreadNotificationsCount };
    }

    // 2. Todas las consultas en paralelo — un único round-trip a MongoDB
    const [
      spaces,
      memberCounts,
      movementTypedStats,
      recentMovementsAgg,
      notifPerSpaceAgg,
      activeLinkInvitations,
      outgoingPendingAgg,
      pendingInvitationsCount,
      unreadNotificationsCount,
    ] = await Promise.all([
      // Espacio completo: nombre, tipo, moneda, descripción, owner, configuración
      this.sharedSpaceModel
        .find({ spaceId: { $in: spaceIds }, estado: 'activo' })
        .select('spaceId nombre tipo monedaBase descripcion ownerUserId configuracion')
        .lean(),

      // Conteo de miembros activos por espacio
      this.sharedMemberModel
        .aggregate([
          { $match: { spaceId: { $in: spaceIds }, estado: 'active' } },
          { $group: { _id: '$spaceId', memberCount: { $sum: 1 } } },
        ])
        .exec(),

      // Totales del período agrupados por espacio+tipo (income/expense)
      this.sharedMovementModel
        .aggregate([
          {
            $match: {
              spaceId: { $in: spaceIds },
              estado: 'published',
              fechaMovimiento: { $gte: start, $lte: end },
            },
          },
          {
            $group: {
              _id: { spaceId: '$spaceId', tipo: '$tipo' },
              total: { $sum: '$montoTotal' },
              count: { $sum: 1 },
              lastAt: { $max: '$fechaMovimiento' },
            },
          },
        ])
        .exec(),

      // Mini-feed: últimos N movimientos por espacio (sin filtro de período)
      this.sharedMovementModel
        .aggregate([
          { $match: { spaceId: { $in: spaceIds }, estado: 'published' } },
          { $sort: { fechaMovimiento: -1 } },
          {
            $group: {
              _id: '$spaceId',
              movements: {
                $push: {
                  movementId: '$movementId',
                  titulo: '$titulo',
                  montoTotal: '$montoTotal',
                  moneda: '$moneda',
                  tipo: '$tipo',
                  fechaMovimiento: '$fechaMovimiento',
                  createdByUserId: '$createdByUserId',
                },
              },
            },
          },
          { $project: { movements: { $slice: ['$movements', movementsLimit] } } },
        ])
        .exec(),

      // Notificaciones no leídas por espacio (para badge por espacio)
      this.sharedNotificationModel
        .aggregate([
          { $match: { userId, read: false } },
          { $group: { _id: '$spaceId', count: { $sum: 1 } } },
        ])
        .exec(),

      // Invitación link activa más reciente por espacio (para compartir QR en 1 tap)
      this.sharedInvitationModel
        .find({
          spaceId: { $in: spaceIds },
          invitationType: 'link',
          estado: 'pending',
          expiresAt: { $gt: new Date() },
        })
        .select('spaceId shareUrl expiresAt multiUse maxUses acceptedCount')
        .sort({ createdAt: -1 })
        .lean(),

      // Invitaciones salientes pendientes por espacio (útil para admins/owners)
      this.sharedInvitationModel
        .aggregate([
          { $match: { spaceId: { $in: spaceIds }, estado: 'pending' } },
          { $group: { _id: '$spaceId', count: { $sum: 1 } } },
        ])
        .exec(),

      // Invitaciones pendientes recibidas por el usuario actual (badge global)
      this.sharedInvitationModel.countDocuments({ invitedUserId: userId, estado: 'pending' }),

      // Notificaciones no leídas totales del usuario (badge global)
      this.sharedNotificationModel.countDocuments({ userId, read: false }),
    ]);

    // 3. Construir mapas para lookup O(1)
    const memberCountMap = new Map(
      (memberCounts as any[]).map((r) => [String(r._id), Number(r.memberCount)]),
    );

    // movementTypedStats: agrupar por spaceId, separar income vs expense
    type SpacePeriodStats = {
      ingresosPeriodo: number;
      egresosPeriodo: number;
      totalMovimientosPeriodo: number;
      lastMovementAt: Date | null;
    };
    const movementStatsMap = new Map<string, SpacePeriodStats>();
    for (const r of movementTypedStats as any[]) {
      const spId = String(r._id.spaceId);
      const tipo = String(r._id.tipo);
      const entry: SpacePeriodStats = movementStatsMap.get(spId) ?? {
        ingresosPeriodo: 0,
        egresosPeriodo: 0,
        totalMovimientosPeriodo: 0,
        lastMovementAt: null,
      };
      const total = Number(r.total ?? 0);
      const count = Number(r.count ?? 0);
      if (tipo === 'income') entry.ingresosPeriodo += total;
      if (tipo === 'expense') entry.egresosPeriodo += total;
      entry.totalMovimientosPeriodo += count;
      const candidateDate = r.lastAt ? new Date(r.lastAt) : null;
      if (candidateDate && (!entry.lastMovementAt || candidateDate > entry.lastMovementAt)) {
        entry.lastMovementAt = candidateDate;
      }
      movementStatsMap.set(spId, entry);
    }

    const recentMvmMap = new Map(
      (recentMovementsAgg as any[]).map((r) => [String(r._id), r.movements ?? []]),
    );
    const notifMap = new Map(
      (notifPerSpaceAgg as any[]).map((r) => [String(r._id), Number(r.count)]),
    );
    const outgoingMap = new Map(
      (outgoingPendingAgg as any[]).map((r) => [String(r._id), Number(r.count)]),
    );

    // Primera invitación link activa por espacio (ya viene ordenada por createdAt desc)
    const activeLinkMap = new Map<string, any>();
    for (const inv of activeLinkInvitations as any[]) {
      const sid = String(inv.spaceId);
      if (!activeLinkMap.has(sid)) activeLinkMap.set(sid, inv);
    }

    // 4. Construir resultado final por espacio
    const spacesResult = (spaces as any[]).map((s) => {
      const id = String(s.spaceId);
      const stats = movementStatsMap.get(id);
      const linkInv = activeLinkMap.get(id);
      return {
        spaceId: id,
        nombre: s.nombre,
        tipo: s.tipo,
        monedaBase: s.monedaBase ?? 'MXN',
        descripcion: s.descripcion || null,
        ownerUserId: s.ownerUserId,
        myRol: myRolMap.get(id) ?? 'member',
        memberCount: memberCountMap.get(id) ?? 0,
        maxMembers: s.configuracion?.maxMembers ?? 20,
        configuracion: s.configuracion ?? null,
        // Totales financieros del período seleccionado
        ingresosPeriodo: stats?.ingresosPeriodo ?? 0,
        egresosPeriodo: stats?.egresosPeriodo ?? 0,
        totalMovimientosPeriodo: stats?.totalMovimientosPeriodo ?? 0,
        lastMovementAt: stats?.lastMovementAt ?? null,
        // Notificaciones no leídas de este espacio
        unreadNotificationsCount: notifMap.get(id) ?? 0,
        // Invitaciones salientes pendientes (para badge en panel de admin)
        pendingOutgoingInvitationsCount: outgoingMap.get(id) ?? 0,
        // Mini-feed: últimos N movimientos
        recentMovements: (recentMvmMap.get(id) ?? []).map((m: any) => ({
          movementId: m.movementId,
          titulo: m.titulo,
          montoTotal: m.montoTotal,
          moneda: m.moneda,
          tipo: m.tipo,
          fechaMovimiento: m.fechaMovimiento,
          createdByUserId: m.createdByUserId,
        })),
        // Invitación link activa más reciente (para compartir QR sin llamada extra)
        activeLinkInvitation: linkInv
          ? {
              shareUrl: linkInv.shareUrl,
              expiresAt: linkInv.expiresAt,
              multiUse: linkInv.multiUse,
              maxUses: (linkInv.maxUses ?? 0) > 0 ? linkInv.maxUses : null,
              acceptedCount: linkInv.acceptedCount ?? 0,
            }
          : null,
      };
    });

    return {
      activeSpacesCount: spacesResult.length,
      pendingInvitationsCount,
      unreadNotificationsCount,
      spaces: spacesResult,
    };
  }

  async getBalanceCard(userId: string, opts?: BalanceCardOptions) {
    const periodo: BalancePeriodo = opts?.periodo ?? 'mes';
    const range = this.resolveBalancePeriodo(periodo);
    const { start, end } = this.resolveRange({ range });

    const labels = this.buildBalancePeriodLabels();

    const cuenta = await this.cuentaModel
      .findOne({ userId, isPrincipal: true })
      .select('id moneda cantidad simbolo color nombre')
      .lean();

    const monedaFiltro = (opts?.moneda ?? '').trim();
    const totals = await this.aggregatePeriodTotals({
      userId,
      start,
      end,
      tipoTransaccion: 'ambos',
      moneda: monedaFiltro || undefined,
    });

    return {
      meta: {
        periodo: {
          key: periodo,
          label: (labels as any)[periodo] ?? 'Mes',
        },
        start: start.toISOString(),
        end: end.toISOString(),
        periods: {
          selected: periodo,
          available: Object.entries(labels).map(([key, label]) => ({ key, label })),
        },
        query: {
          moneda: monedaFiltro || null,
        },
      },
      account: {
        saldo: Number((cuenta as any)?.cantidad ?? 0),
        moneda: String((cuenta as any)?.moneda ?? 'MXN'),
      },
      totals: {
        ingresos: Number(totals.ingresos ?? 0),
        egresos: Number(totals.egresos ?? 0),
      },
    };
  }

  async getExpensesChart(userId: string, opts?: SnapshotOptions) {
    const { range, start, end, isCustom } = this.resolveRange(opts);

    const chartGranularity: 'hour' | 'day' | 'month' =
      range === 'day' ? 'hour' : range === 'year' || range === 'all' ? 'month' : 'day';

    const chartDateFormat =
      chartGranularity === 'hour'
        ? '%Y-%m-%dT%H:00'
        : chartGranularity === 'month'
          ? '%Y-%m'
          : '%Y-%m-%d';

    const chartMaxPoints =
      chartGranularity === 'hour'
        ? 48
        : chartGranularity === 'month'
          ? range === 'all'
            ? 240
            : 24
          : range === '6months'
            ? 250
            : range === '3months'
              ? 120
              : range === 'month'
                ? 60
                : 30;

    const tipo = opts?.tipoTransaccion ?? 'ambos';
    const moneda = (opts?.moneda ?? '').trim();
    const tipoMatch = tipo !== 'ambos' ? { tipo } : {};

    const monedaClause = moneda ? { $or: [{ moneda }, { monedaConvertida: moneda }] } : null;
    const dateClause = {
      $or: [
        { fecha: { $gte: start, $lte: end } },
        { fecha: { $exists: false }, createdAt: { $gte: start, $lte: end } },
      ],
    };
    const andMatch = monedaClause ? { $and: [dateClause, monedaClause] } : dateClause;

    const rows = await this.transactionModel
      .aggregate([
        {
          $match: {
            userId,
            ...tipoMatch,
            ...andMatch,
          },
        },
        {
          $project: {
            tipo: 1,
            amount: { $abs: { $ifNull: ['$montoConvertido', '$monto'] } },
            bucket: {
              $dateToString: { format: chartDateFormat, date: { $ifNull: ['$fecha', '$createdAt'] } },
            },
          },
        },
        {
          $group: {
            _id: '$bucket',
            ingreso: {
              $sum: {
                $cond: [{ $eq: ['$tipo', 'ingreso'] }, '$amount', 0],
              },
            },
            egreso: {
              $sum: {
                $cond: [{ $eq: ['$tipo', 'egreso'] }, '$amount', 0],
              },
            },
          },
        },
        { $sort: { _id: -1 } },
        { $limit: chartMaxPoints },
        { $sort: { _id: 1 } },
      ])
      .exec();

    return {
      meta: {
        range,
        isCustom,
        start: start.toISOString(),
        end: end.toISOString(),
        query: {
          tipoTransaccion: tipo,
          moneda: moneda || null,
          fechaInicio: opts?.fechaInicio ?? null,
          fechaFin: opts?.fechaFin ?? null,
        },
        chart: {
          granularity: chartGranularity,
          maxPoints: chartMaxPoints,
        },
      },
      points: (rows ?? []).map((p: any) => ({
        date: p?._id,
        ingreso: Number(p?.ingreso ?? 0),
        egreso: Number(p?.egreso ?? 0),
      })),
    };
  }

  async getTotals(userId: string) {
    const [subcuentasTotalsAgg, recurrentesTotalsAgg] = await Promise.all([
      this.subcuentaModel
        .aggregate([
          { $match: { userId } },
          {
            $project: {
              moneda: 1,
              cantidad: 1,
              activa: { $ifNull: ['$activa', true] },
              pausadaPorPlan: { $ifNull: ['$pausadaPorPlan', false] },
            },
          },
          {
            $addFields: {
              bucket: {
                $cond: [
                  { $eq: ['$pausadaPorPlan', true] },
                  'paused',
                  { $cond: [{ $eq: ['$activa', true] }, 'active', 'inactive'] },
                ],
              },
            },
          },
          { $match: { bucket: { $in: ['active', 'paused'] } } },
          {
            $group: {
              _id: { bucket: '$bucket', moneda: '$moneda' },
              total: { $sum: '$cantidad' },
              count: { $sum: 1 },
            },
          },
          { $sort: { '_id.bucket': 1, '_id.moneda': 1 } },
        ])
        .exec(),

      this.recurrenteModel
        .aggregate([
          { $match: { userId } },
          {
            $project: {
              moneda: 1,
              monto: 1,
              pausado: { $ifNull: ['$pausado', false] },
              pausadoPorPlan: { $ifNull: ['$pausadoPorPlan', false] },
            },
          },
          {
            $addFields: {
              bucket: { $cond: [{ $or: ['$pausado', '$pausadoPorPlan'] }, 'paused', 'active'] },
            },
          },
          {
            $group: {
              _id: { bucket: '$bucket', moneda: '$moneda' },
              total: { $sum: '$monto' },
              count: { $sum: 1 },
            },
          },
          { $sort: { '_id.bucket': 1, '_id.moneda': 1 } },
        ])
        .exec(),
    ]);

    const buildTotals = (rows: any[]) => {
      const activeByCurrency: Array<{ moneda: string; total: number; count: number }> = [];
      const pausedByCurrency: Array<{ moneda: string; total: number; count: number }> = [];
      for (const r of rows ?? []) {
        const bucket = String(r?._id?.bucket ?? '');
        const moneda = String(r?._id?.moneda ?? '');
        const item = {
          moneda,
          total: Number(r?.total ?? 0),
          count: Number(r?.count ?? 0),
        };
        if (bucket === 'active') activeByCurrency.push(item);
        if (bucket === 'paused') pausedByCurrency.push(item);
      }
      const sumTotal = (arr: Array<{ total: number }>) => arr.reduce((s, x) => s + Number(x.total ?? 0), 0);
      const sumCount = (arr: Array<{ count: number }>) => arr.reduce((s, x) => s + Number(x.count ?? 0), 0);
      return {
        active: {
          total: sumTotal(activeByCurrency),
          count: sumCount(activeByCurrency),
          byCurrency: activeByCurrency,
        },
        paused: {
          total: sumTotal(pausedByCurrency),
          count: sumCount(pausedByCurrency),
          byCurrency: pausedByCurrency,
        },
      };
    };

    return {
      subaccountsTotals: buildTotals(subcuentasTotalsAgg as any),
      recurrentesTotals: buildTotals(recurrentesTotalsAgg as any),
    };
  }
}
