import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subcuenta, SubcuentaDocument } from '../../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { Recurrente, RecurrenteDocument } from '../../recurrentes/schemas/recurrente.schema';
import { DashboardVersionService } from './dashboard-version.service';
import { PlanConfigService } from '../../plan-config/plan-config.service';

@Injectable()
export class PlanAutoPauseService {
  private readonly logger = new Logger(PlanAutoPauseService.name);

  // Best-effort cooldown para evitar saturación si llegan varios eventos seguidos (Stripe + cron + login)
  private readonly cooldown = new Map<string, number>();
  private readonly cooldownMs = 30_000;

  constructor(
    @InjectModel(Subcuenta.name) private subcuentaModel: Model<SubcuentaDocument>,
    @InjectModel(Recurrente.name) private recurrenteModel: Model<RecurrenteDocument>,
    private readonly dashboardVersionService: DashboardVersionService,
    private readonly planConfigService: PlanConfigService,
  ) {}

  private shouldSkip(userId: string, targetPlanType: 'free_plan' | 'premium_plan'): boolean {
    const key = `${userId}:${targetPlanType}`;
    const now = Date.now();
    const until = this.cooldown.get(key) ?? 0;
    if (now < until) return true;
    this.cooldown.set(key, now + this.cooldownMs);
    return false;
  }

  private resolveLimit(raw: unknown, fallback: number): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    if (n === -1) return Infinity;
    if (n <= 0) return fallback;
    return n;
  }

  /**
   * Enforzar límites del plan de forma persistente en DB.
   * - Si el plan es ilimitado: reanuda TODO lo pausado por plan.
   * - Si el plan es limitado: mantiene las N más nuevas y pausa el resto.
   */
  async enforcePlanLimits(
    userId: string,
    targetPlanType: 'free_plan' | 'premium_plan',
    reason: string,
  ): Promise<{ subcuentasPausadas: number; subcuentasReanudadas: number; recurrentesPausados: number; recurrentesReanudados: number }> {
    if (this.shouldSkip(userId, targetPlanType)) {
      this.logger.log(`[PlanAutoPause] Cooldown activo, skip user=${userId} plan=${targetPlanType}`);
      return { subcuentasPausadas: 0, subcuentasReanudadas: 0, recurrentesPausados: 0, recurrentesReanudados: 0 };
    }

    const planConfig = await this.planConfigService.findByPlanType(targetPlanType);
    const subLimit = this.resolveLimit((planConfig as any)?.subcuentasPorUsuario, 5);
    const recLimit = this.resolveLimit((planConfig as any)?.recurrentesPorUsuario, 10);

    this.logger.log(
      `[PlanAutoPause] enforcePlanLimits user=${userId} plan=${targetPlanType} subLimit=${subLimit} recLimit=${recLimit} reason=${reason}`,
    );

    // ----- SUBCUENTAS -----
    let subcuentasPausadas = 0;
    let subcuentasReanudadas = 0;

    if (subLimit === Infinity) {
      const res = await this.subcuentaModel.updateMany(
        { userId, pausadaPorPlan: true },
        { $set: { activa: true, pausadaPorPlan: false } },
      );
      subcuentasReanudadas = res.modifiedCount;
    } else {
      const keepers = await this.subcuentaModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(subLimit)
        .select('subCuentaId')
        .lean();

      const keeperIds = (keepers ?? [])
        .map((x: any) => String(x?.subCuentaId ?? ''))
        .filter(Boolean);

      // Reanudar solo las que estaban pausadas por plan y ahora están dentro del límite
      if (keeperIds.length) {
        const resumeRes = await this.subcuentaModel.updateMany(
          { userId, subCuentaId: { $in: keeperIds }, pausadaPorPlan: true },
          { $set: { activa: true, pausadaPorPlan: false } },
        );
        subcuentasReanudadas = resumeRes.modifiedCount;
      }

      // Pausar todo lo que quede fuera del límite (idempotente)
      const pauseQuery: any = { userId, pausadaPorPlan: { $ne: true } };
      if (keeperIds.length) {
        pauseQuery.subCuentaId = { $nin: keeperIds };
      } else {
        // planLimit podría ser 0 (no debería), en ese caso pausar todas
      }

      const pauseRes = await this.subcuentaModel.updateMany(
        pauseQuery,
        { $set: { activa: false, pausadaPorPlan: true } },
      );
      subcuentasPausadas = pauseRes.modifiedCount;
    }

    // ----- RECURRENTES -----
    let recurrentesPausados = 0;
    let recurrentesReanudados = 0;

    const recurrentesBaseQuery = { userId, estado: { $ne: 'completado' } };

    if (recLimit === Infinity) {
      const res = await this.recurrenteModel.updateMany(
        { userId, pausadoPorPlan: true },
        { $set: { pausado: false, estado: 'activo', pausadoPorPlan: false } },
      );
      recurrentesReanudados = res.modifiedCount;
    } else {
      const keepers = await this.recurrenteModel
        .find(recurrentesBaseQuery)
        .sort({ createdAt: -1 })
        .limit(recLimit)
        .select('recurrenteId')
        .lean();

      const keeperIds = (keepers ?? [])
        .map((x: any) => String(x?.recurrenteId ?? ''))
        .filter(Boolean);

      // Reanudar solo los que estaban pausados por plan y ahora entran en el límite
      if (keeperIds.length) {
        const resumeRes = await this.recurrenteModel.updateMany(
          { userId, recurrenteId: { $in: keeperIds }, pausadoPorPlan: true },
          { $set: { pausado: false, estado: 'activo', pausadoPorPlan: false } },
        );
        recurrentesReanudados = resumeRes.modifiedCount;
      }

      // Pausar lo que quede fuera del límite (sin tocar completados)
      const pauseQuery: any = { ...recurrentesBaseQuery, pausadoPorPlan: { $ne: true } };
      if (keeperIds.length) {
        pauseQuery.recurrenteId = { $nin: keeperIds };
      }

      const pauseRes = await this.recurrenteModel.updateMany(
        pauseQuery,
        { $set: { pausado: true, estado: 'pausado', pausadoPorPlan: true } },
      );
      recurrentesPausados = pauseRes.modifiedCount;
    }

    if (subcuentasPausadas || subcuentasReanudadas || recurrentesPausados || recurrentesReanudados) {
      await this.dashboardVersionService.touchDashboard(userId, `plan.enforce:${reason}`);
    }

    return { subcuentasPausadas, subcuentasReanudadas, recurrentesPausados, recurrentesReanudados };
  }

  /**
   * Pausa automáticamente subcuentas y recurrentes cuando el usuario pierde premium
   */
  async pauseOnPremiumExpiry(userId: string): Promise<{
    subcuentasPausadas: number;
    recurrentesPausados: number;
  }> {
    const result = await this.enforcePlanLimits(userId, 'free_plan', 'premium.expired');
    return { subcuentasPausadas: result.subcuentasPausadas, recurrentesPausados: result.recurrentesPausados };
  }

  /**
   * Reanuda automáticamente subcuentas y recurrentes cuando el usuario recupera premium
   */
  async resumeOnPremiumReactivation(userId: string): Promise<{
    subcuentasReanudadas: number;
    recurrentesReanudados: number;
  }> {
    const result = await this.enforcePlanLimits(userId, 'premium_plan', 'premium.reactivated');
    return { subcuentasReanudadas: result.subcuentasReanudadas, recurrentesReanudados: result.recurrentesReanudados };
  }

  /**
   * Verifica y ejecuta pausas/reanudaciones según el cambio de estado de premium
   */
  async handlePlanTransition(
    userId: string, 
    wasPremium: boolean, 
    isPremiumNow: boolean
  ): Promise<{ subcuentas?: number; recurrentes?: number }> {
    // Perdió premium
    if (wasPremium && !isPremiumNow) {
      const result = await this.enforcePlanLimits(userId, 'free_plan', 'transition.lostPremium');
      return { subcuentas: result.subcuentasPausadas, recurrentes: result.recurrentesPausados };
    }
    
    // Recuperó premium
    if (!wasPremium && isPremiumNow) {
      const result = await this.enforcePlanLimits(userId, 'premium_plan', 'transition.gainedPremium');
      return { subcuentas: result.subcuentasReanudadas, recurrentes: result.recurrentesReanudados };
    }

    return {};
  }
}
