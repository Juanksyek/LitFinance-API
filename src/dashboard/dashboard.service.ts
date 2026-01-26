import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import { Cuenta, CuentaDocument } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaDocument } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { Recurrente, RecurrenteDocument } from '../recurrentes/schemas/recurrente.schema';
import { Transaction, TransactionDocument } from '../transactions/schemas/transaction.schema/transaction.schema';
import { PlanConfigService } from '../plan-config/plan-config.service';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';

type SnapshotRange = 'day' | 'week' | 'month' | '3months' | '6months' | 'year';

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
  recurrentesLimit?: number;
  recurrentesPage?: number;
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
    @InjectModel(Recurrente.name) private readonly recurrenteModel: Model<RecurrenteDocument>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    private readonly planConfigService: PlanConfigService,
    private readonly cuentaHistorialService: CuentaHistorialService,
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

  async getSnapshot(userId: string, version: string, opts?: SnapshotOptions) {
    const { range, start, end, isCustom } = this.resolveRange(opts);

    const chartGranularity: 'hour' | 'day' | 'month' =
      range === 'day' ? 'hour' : range === 'year' ? 'month' : 'day';

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
          ? 24
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
    const monedaMatch = moneda
      ? {
          $or: [{ moneda }, { monedaConvertida: moneda }],
        }
      : {};

    const [cuenta, subcuentas, recurrentes, recentTransactions, periodAgg, chartPoints] = await Promise.all([
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

      this.recurrenteModel
        .find({ userId })
        .select(
          'recurrenteId nombre monto moneda frecuenciaTipo frecuenciaValor proximaEjecucion pausado pausadoPorPlan estado plataforma',
        )
        .sort({ createdAt: -1 })
        .skip(recurrentesSkip)
        .limit(recurrentesLimit)
        .lean(),

      this.transactionModel
        .find({ userId })
        .select('transaccionId tipo monto montoConvertido moneda monedaConvertida concepto cuentaId subCuentaId createdAt')
        .sort({ createdAt: -1 })
        .skip(recentSkip)
        .limit(recentLimit)
        .lean(),

      this.transactionModel
        .aggregate([
          { $match: { userId, createdAt: { $gte: start, $lte: end }, ...tipoMatch, ...monedaMatch } },
          {
            $project: {
              tipo: 1,
              amount: {
                $ifNull: ['$montoConvertido', '$monto'],
              },
            },
          },
          {
            $group: {
              _id: '$tipo',
              total: { $sum: '$amount' },
            },
          },
        ])
        .exec(),

      this.transactionModel
        .aggregate([
          { $match: { userId, createdAt: { $gte: start, $lte: end }, ...tipoMatch, ...monedaMatch } },
          {
            $project: {
              tipo: 1,
              amount: { $abs: { $ifNull: ['$montoConvertido', '$monto'] } },
              bucket: {
                $dateToString: { format: chartDateFormat, date: '$createdAt' },
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
          { $sort: { _id: 1 } },
          { $limit: chartMaxPoints },
        ])
        .exec(),
    ]);

    const recentHistory = cuenta?.id
      ? await this.cuentaHistorialService.buscarHistorial(String(cuenta.id), recentPage, recentLimit)
      : { total: 0, page: recentPage, limit: recentLimit, data: [] };

    const ingresosPeriodo = Number(periodAgg?.find((x: any) => x._id === 'ingreso')?.total ?? 0);
    const egresosPeriodo = Number(periodAgg?.find((x: any) => x._id === 'egreso')?.total ?? 0);

    const snapshot = {
      meta: {
        version,
        generatedAt: new Date().toISOString(),
        plan: { type: planType, isPremium },
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
      subaccountsSummary: (subcuentas ?? []).map((s: any) => ({
        id: s.subCuentaId,
        nombre: s.nombre,
        saldo: s.cantidad,
        moneda: s.moneda,
        activa: s.activa,
        pausadaPorPlan: !!s.pausadaPorPlan,
        color: s.color ?? null,
        simbolo: s.simbolo ?? null,
      })),
      recurrentesSummary: (recurrentes ?? []).map((r: any) => ({
        id: r.recurrenteId,
        nombre: r.nombre,
        color: r?.plataforma?.color ?? null,
        monto: r.monto,
        moneda: r.moneda,
        frecuenciaTipo: r.frecuenciaTipo ?? null,
        frecuenciaValor: r.frecuenciaValor,
        nextRun: r.proximaEjecucion,
        estado: r.estado,
        pausado: !!r.pausado,
        pausadoPorPlan: !!r.pausadoPorPlan,
      })),
      recentTransactions: (recentTransactions ?? []).map((t: any) => ({
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
    };

    this.microCache.set(cacheKey, { expiresAt: nowMs + this.microCacheTtlMs, data: snapshot });
    return snapshot;
  }
}
