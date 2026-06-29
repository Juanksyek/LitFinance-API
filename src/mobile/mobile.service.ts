import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MonedaService } from '../moneda/moneda.service';
import { RedisService } from '../redis/redis.service';
import { CuentaHistorial, CuentaHistorialDocument } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { Recurrente, RecurrenteDocument } from '../recurrentes/schemas/recurrente.schema';
import { Subcuenta, SubcuentaDocument } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { Transaction, TransactionDocument } from '../transactions/schemas/transaction.schema/transaction.schema';
import { UserService } from '../user/user.service';
import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import { DashboardVersionService } from '../user/services/dashboard-version.service';

const BOOTSTRAP_CACHE_TTL_SECONDS = 60;
const BOOTSTRAP_CATALOG_TTL_SECONDS = 300;

type SyncCursorBucketKey =
  | 'transactionsCreated'
  | 'transactionsUpdated'
  | 'transactionsDeleted'
  | 'subcuentasCreated'
  | 'subcuentasUpdated'
  | 'recurrentesCreated'
  | 'recurrentesUpdated';

type SyncCursorPayload = {
  since: string;
  buckets?: Partial<Record<SyncCursorBucketKey, string>>;
};

@Injectable()
export class MobileService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<SubcuentaDocument>,
    @InjectModel(Recurrente.name) private readonly recurrenteModel: Model<RecurrenteDocument>,
    @InjectModel(CuentaHistorial.name) private readonly cuentaHistorialModel: Model<CuentaHistorialDocument>,
    private readonly userService: UserService,
    private readonly monedaService: MonedaService,
    private readonly redisService: RedisService,
    private readonly dashboardVersionService: DashboardVersionService,
  ) {}

  async getBootstrapVersion(userId: string): Promise<string> {
    const user = await this.userModel
      .findOne({ id: userId })
      .select('updatedAt dashboardVersion')
      .lean();

    const updatedAtMs = new Date((user as any)?.updatedAt ?? 0).getTime() || 0;
    const dashboardVersion = Number((user as any)?.dashboardVersion ?? 0);
    return `${updatedAtMs}:${dashboardVersion}`;
  }

  async getBootstrap(userId: string, bootstrapVersion?: string) {
    const resolvedVersion =
      String(bootstrapVersion ?? '').trim() || (await this.getBootstrapVersion(userId));
    const cacheKey = `lf:mobile:bootstrap:${userId}:${resolvedVersion}`;
    const cached = await this.redisService.get<Record<string, unknown>>(cacheKey);

    const coreData = cached ?? (await this.buildBootstrapCore(userId));
    if (!cached) {
      await this.redisService.set(cacheKey, coreData, BOOTSTRAP_CACHE_TTL_SECONDS);
    }

    return {
      serverTime: new Date().toISOString(),
      bootstrapVersion: resolvedVersion,
      ...coreData,
    };
  }

  async getSync(userId: string, sinceIso: string, limit = 100, cursor?: string) {
    const since = new Date(sinceIso);
    const serverTime = new Date().toISOString();
    const safeLimit = Math.min(200, Math.max(1, Number(limit || 100)));
    const parsedCursor = this.parseSyncCursor(cursor, sinceIso);

    const [profile, transactions, transactionDeletes, subcuentas, recurrentes] =
      await Promise.all([
        this.userModel
          .findOne({
            id: userId,
            updatedAt: { $gt: since },
          })
          .select(
            'id nombreCompleto monedaPrincipal monedaPreferencia monedasFavoritas usarSubcuentaPorDefectoEnRecurrentes subcuentaPorDefectoRecurrentesId isPremium planType updatedAt',
          )
          .lean(),
        this.readSyncBucket({
          model: this.transactionModel,
          userId,
          since,
          createdSince: this.resolveCursorDate(parsedCursor, 'transactionsCreated', since),
          updatedSince: this.resolveCursorDate(parsedCursor, 'transactionsUpdated', since),
          idField: 'transaccionId',
          limit: safeLimit,
          projection:
            'transaccionId tipo monto moneda concepto motivo userId fecha registradoEn cuentaId subCuentaId afectaCuenta montoConvertido monedaConvertida tasaConversion fechaConversion montoSubcuentaConvertido monedaSubcuentaConvertida tasaConversionSubcuenta fechaConversionSubcuenta createdAt updatedAt',
        }),
        this.readDeletedTransactions(
          userId,
          this.resolveCursorDate(parsedCursor, 'transactionsDeleted', since),
          safeLimit,
        ),
        this.readSyncBucket({
          model: this.subcuentaModel,
          userId,
          since,
          createdSince: this.resolveCursorDate(parsedCursor, 'subcuentasCreated', since),
          updatedSince: this.resolveCursorDate(parsedCursor, 'subcuentasUpdated', since),
          idField: 'subCuentaId',
          limit: safeLimit,
          projection:
            'subCuentaId nombre cantidad moneda simbolo color cuentaId afectaCuenta origenSaldo userId activa isMeta pausadaPorPlan allowOverdraft overdraftLimit montoConvertido tasaConversion fechaConversion createdAt updatedAt',
        }),
        this.readSyncBucket({
          model: this.recurrenteModel,
          userId,
          since,
          createdSince: this.resolveCursorDate(parsedCursor, 'recurrentesCreated', since),
          updatedSince: this.resolveCursorDate(parsedCursor, 'recurrentesUpdated', since),
          idField: 'recurrenteId',
          limit: safeLimit,
          projection:
            'recurrenteId nombre plataforma frecuenciaTipo frecuenciaValor moneda monto afectaCuentaPrincipal cuentaId subcuentaId afectaSubcuenta proximaEjecucion userId recordatorios pausado pausadoPorPlan estado ultimaEjecucion mensajeError tipoRecurrente totalPagos pagosRealizados fechaInicio fechaFin createdAt updatedAt',
        }),
      ]);

    const nextCursor = this.buildNextSyncCursor({
      since: since.toISOString(),
      transactions,
      transactionDeletes,
      subcuentas,
      recurrentes,
    });

    return {
      serverTime,
      changes: {
        profile: {
          updated: profile
            ? {
                id: (profile as any).id,
                nombreCompleto: (profile as any).nombreCompleto,
                monedaPrincipal: (profile as any).monedaPrincipal,
                monedaPreferencia: (profile as any).monedaPreferencia,
                monedasFavoritas: (profile as any).monedasFavoritas ?? [],
                usarSubcuentaPorDefectoEnRecurrentes:
                  (profile as any).usarSubcuentaPorDefectoEnRecurrentes ?? false,
                subcuentaPorDefectoRecurrentesId:
                  (profile as any).subcuentaPorDefectoRecurrentesId ?? null,
                isPremium: (profile as any).isPremium ?? false,
                planType: (profile as any).planType ?? 'free_plan',
                updatedAt: (profile as any).updatedAt,
              }
            : null,
        },
        transactions: {
          ...transactions,
          deleted: transactionDeletes.items,
        },
        subcuentas,
        recurrentes,
      },
      meta: {
        since: since.toISOString(),
        limit: safeLimit,
        nextCursor,
        partialDeletions: {
          transactions: transactionDeletes.items.length > 0,
          subcuentas: false,
          recurrentes: false,
        },
      },
    };
  }

  private async buildBootstrapCore(userId: string) {
    const [profile, catalogoMonedas, dashboardVersion] = await Promise.all([
      this.userService.getProfile(userId),
      this.getCachedCatalogoMonedas(),
      this.dashboardVersionService.touchlessGetDashboardVersion(userId),
    ]);

    const role = String((profile as any)?.rol ?? 'usuario');
    const planType = String((profile as any)?.planType ?? 'free_plan');
    const isPremium = !!(profile as any)?.isPremium;
    const permissions = this.buildPermissions({ role, planType, isPremium });
    const features = this.buildFeatures({ planType });

    return {
      user: {
        id: (profile as any).id,
        email: (profile as any).email,
        rol: role,
      },
      profile: {
        nombreCompleto: (profile as any).nombreCompleto,
        monedaPrincipal: (profile as any).monedaPrincipal,
        monedaPreferencia: (profile as any).monedaPreferencia,
        isPremium,
        planType,
      },
      settings: {
        monedasFavoritas: (profile as any).monedasFavoritas ?? [],
        usarSubcuentaPorDefectoEnRecurrentes:
          (profile as any).usarSubcuentaPorDefectoEnRecurrentes ?? false,
        subcuentaPorDefectoRecurrentesId:
          (profile as any).subcuentaPorDefectoRecurrentesId ?? null,
      },
      permissions,
      features,
      initialData: {
        catalogoMonedas,
        dashboardVersion,
      },
    };
  }

  private async getCachedCatalogoMonedas() {
    const cacheKey = 'lf:mobile:catalogs:monedas:v1';
    const cached = await this.redisService.get<any[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const catalog = await this.monedaService.obtenerCatalogoPublico();
    await this.redisService.set(cacheKey, catalog, BOOTSTRAP_CATALOG_TTL_SECONDS);
    return catalog;
  }

  private buildPermissions(params: {
    role: string;
    planType: string;
    isPremium: boolean;
  }): string[] {
    const permissions = new Set<string>([
      'profile.read',
      'profile.update',
      'dashboard.read',
      'transactions.read',
      'transactions.write',
      'subaccounts.read',
      'subaccounts.write',
      'recurrentes.read',
      'recurrentes.write',
      'sync.pull',
      'sync.push',
    ]);

    if (params.planType === 'premium_plan' || params.isPremium) {
      permissions.add('reports.export');
      permissions.add('analytics.advanced');
      permissions.add('creditcards.read');
      permissions.add('creditcards.write');
    }

    if (params.role === 'admin') {
      permissions.add('admin.access');
    }

    return Array.from(permissions).sort();
  }

  private buildFeatures(params: { planType: string }) {
    const isPremiumPlan = params.planType === 'premium_plan';
    return {
      reportesExportables: isPremiumPlan,
      graficasAvanzadas: isPremiumPlan,
      offlineSyncPush: true,
      offlineSyncPull: true,
    };
  }

  private async readSyncBucket(params: {
    model: Model<any>;
    userId: string;
    since: Date;
    createdSince: Date;
    updatedSince: Date;
    idField: string;
    limit: number;
    projection: string;
  }) {
    const createdRows = await params.model
      .find({
        userId: params.userId,
        createdAt: { $gt: params.createdSince },
      })
      .select(params.projection)
      .sort({ createdAt: 1 })
      .limit(params.limit + 1)
      .lean();

    const updatedRows = await params.model
      .find({
        userId: params.userId,
        createdAt: { $lte: params.since },
        updatedAt: { $gt: params.updatedSince },
      })
      .select(params.projection)
      .sort({ updatedAt: 1 })
      .limit(params.limit + 1)
      .lean();

    const created = createdRows.slice(0, params.limit);
    const updated = updatedRows.slice(0, params.limit);

    return {
      created,
      updated,
      hasMoreCreated: createdRows.length > params.limit,
      hasMoreUpdated: updatedRows.length > params.limit,
      deleted: [],
    };
  }

  private async readDeletedTransactions(userId: string, since: Date, limit: number) {
    const deletedMovements = await this.cuentaHistorialModel
      .find({
        userId,
        'metadata.audit.status': 'deleted',
        'metadata.audit.deletedAt': { $gt: since.toISOString() },
      })
      .select('metadata')
      .sort({ 'metadata.audit.deletedAt': 1 })
      .limit(limit + 1)
      .lean();

    const items = deletedMovements
      .slice(0, limit)
      .map((item: any) => item?.metadata?.audit?.transaccionId)
      .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0);

    return {
      items,
      hasMore: deletedMovements.length > limit,
      lastDeletedAt:
        deletedMovements.length > 0
          ? String(
              deletedMovements[Math.min(limit, deletedMovements.length) - 1]?.metadata?.audit
                ?.deletedAt ?? '',
            ) || null
          : null,
    };
  }

  private parseSyncCursor(cursor: string | undefined, sinceIso: string): SyncCursorPayload | null {
    if (!cursor) return null;

    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded) as SyncCursorPayload;
      if (!parsed?.since || parsed.since !== sinceIso) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private resolveCursorDate(
    cursor: SyncCursorPayload | null,
    key: SyncCursorBucketKey,
    fallback: Date,
  ) {
    const raw = cursor?.buckets?.[key];
    if (!raw) {
      return fallback;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }

  private buildNextSyncCursor(params: {
    since: string;
    transactions: {
      created: any[];
      updated: any[];
      hasMoreCreated: boolean;
      hasMoreUpdated: boolean;
    };
    transactionDeletes: {
      items: string[];
      hasMore: boolean;
      lastDeletedAt: string | null;
    };
    subcuentas: {
      created: any[];
      updated: any[];
      hasMoreCreated: boolean;
      hasMoreUpdated: boolean;
    };
    recurrentes: {
      created: any[];
      updated: any[];
      hasMoreCreated: boolean;
      hasMoreUpdated: boolean;
    };
  }) {
    const buckets: Partial<Record<SyncCursorBucketKey, string>> = {};

    if (params.transactions.hasMoreCreated) {
      const value = this.readLastTimestamp(params.transactions.created, 'createdAt');
      if (value) buckets.transactionsCreated = value;
    }
    if (params.transactions.hasMoreUpdated) {
      const value = this.readLastTimestamp(params.transactions.updated, 'updatedAt');
      if (value) buckets.transactionsUpdated = value;
    }
    if (params.transactionDeletes.hasMore && params.transactionDeletes.lastDeletedAt) {
      buckets.transactionsDeleted = params.transactionDeletes.lastDeletedAt;
    }
    if (params.subcuentas.hasMoreCreated) {
      const value = this.readLastTimestamp(params.subcuentas.created, 'createdAt');
      if (value) buckets.subcuentasCreated = value;
    }
    if (params.subcuentas.hasMoreUpdated) {
      const value = this.readLastTimestamp(params.subcuentas.updated, 'updatedAt');
      if (value) buckets.subcuentasUpdated = value;
    }
    if (params.recurrentes.hasMoreCreated) {
      const value = this.readLastTimestamp(params.recurrentes.created, 'createdAt');
      if (value) buckets.recurrentesCreated = value;
    }
    if (params.recurrentes.hasMoreUpdated) {
      const value = this.readLastTimestamp(params.recurrentes.updated, 'updatedAt');
      if (value) buckets.recurrentesUpdated = value;
    }

    if (Object.keys(buckets).length === 0) {
      return null;
    }

    return Buffer.from(
      JSON.stringify({
        since: params.since,
        buckets,
      }),
      'utf8',
    ).toString('base64url');
  }

  private readLastTimestamp(items: any[], field: 'createdAt' | 'updatedAt') {
    if (!items.length) return null;
    const raw = items[items.length - 1]?.[field];
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
}
