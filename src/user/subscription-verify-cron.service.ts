import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema/user.schema';
import { StripeService } from '../stripe/stripe.service';
import { reconcileEntitlements } from './premium-entitlements';

@Injectable()
export class SubscriptionVerifyCronService {
  private readonly logger = new Logger(SubscriptionVerifyCronService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly stripeSvc: StripeService,
  ) {}

  async verifyOne(params: { subscriptionId?: string; userMongoId?: string }) {
    const subscriptionId = params?.subscriptionId;
    const userMongoId = params?.userMongoId;
    if (!subscriptionId && !userMongoId) {
      throw new Error('subscriptionId o userMongoId es requerido');
    }

    const user = userMongoId
      ? await this.userModel.findById(userMongoId).lean()
      : await this.userModel.findOne({ premiumSubscriptionId: subscriptionId }).lean();

    if (!user) {
      throw new Error('Usuario no encontrado para verificación');
    }

    const subId = subscriptionId || (user as any).premiumSubscriptionId;
    if (!subId || typeof subId !== 'string' || subId === 'tipjar') {
      throw new Error('El usuario no tiene una suscripción válida para verificar');
    }

    const now = new Date();
    const subscription = (await this.stripeSvc.stripe.subscriptions.retrieve(subId)) as any;
    let periodEnd = subscription?.current_period_end ? new Date(subscription.current_period_end * 1000) : null;
    if (!periodEnd) {
      try {
        periodEnd = await this.stripeSvc.resolveSubscriptionPeriodEnd(subscription as any);
      } catch (err: any) {
        this.logger.warn(`No se pudo resolver period_end para ${subId}: ${err?.message || err}`);
      }
    }
    const expectedStatus = subscription?.status || null;

    const reconciled = reconcileEntitlements(
      {
        ...(user as any),
        premiumSubscriptionId: subId,
        premiumSubscriptionStatus: expectedStatus,
        premiumSubscriptionUntil: periodEnd,
      },
      now,
    );

    const update: any = {
      premiumSubscriptionId: subId,
      premiumSubscriptionStatus: expectedStatus,
      premiumSubscriptionUntil: periodEnd,

      jarExpiresAt: reconciled.jarExpiresAt,
      jarRemainingMs: reconciled.jarRemainingMs,

      premiumUntil: reconciled.premiumUntil,
      isPremium: reconciled.isPremium,
      planType: reconciled.planType,
    };

    if ('premiumBonusDays' in reconciled) update.premiumBonusDays = reconciled.premiumBonusDays;
    if ('premiumSubscriptionId' in reconciled) update.premiumSubscriptionId = reconciled.premiumSubscriptionId;
    if ('premiumSubscriptionStatus' in reconciled) update.premiumSubscriptionStatus = reconciled.premiumSubscriptionStatus;
    if ('premiumSubscriptionUntil' in reconciled) update.premiumSubscriptionUntil = reconciled.premiumSubscriptionUntil;

    await this.userModel.updateOne({ _id: (user as any)._id }, { $set: update });

    return {
      userMongoId: String((user as any)._id),
      subscriptionId: subId,
      stripeStatus: expectedStatus,
      premiumUntil: reconciled.premiumUntil,
      isPremium: reconciled.isPremium,
      planType: reconciled.planType,
      jarExpiresAt: reconciled.jarExpiresAt,
      jarRemainingMs: reconciled.jarRemainingMs,
    };
  }

  /**
   * Verifica un pequeño lote de suscripciones contra Stripe cada 6 horas.
   * - Solo procesa usuarios con `premiumSubscriptionId` (no 'tipjar')
   * - Limita batch para evitar sobrecarga
   */
  @Cron('0 */6 * * *', { timeZone: 'America/Mexico_City' })
  async verifySubscriptions() {
    this.logger.log('🔎 Verificando suscripciones con Stripe (batch limitado)...');
    try {
      const now = new Date();
      const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 días

      const users = await this.userModel.find({
        premiumSubscriptionId: { $exists: true, $nin: [null, 'tipjar'] },
        $or: [
          { premiumSubscriptionStatus: { $nin: ['active', 'trialing'] } },
          { premiumSubscriptionUntil: { $exists: false } },
          { premiumSubscriptionUntil: { $lte: soon } },
        ],
      })
        .select(
          '_id premiumSubscriptionId premiumSubscriptionStatus premiumSubscriptionUntil ' +
            'jarExpiresAt jarRemainingMs premiumUntil isPremium planType premiumBonusDays',
        )
        .limit(50)
        .lean();

      if (!users || users.length === 0) {
        this.logger.log('✅ No hay suscripciones a verificar en este batch');
        return;
      }

      const bulkOps: any[] = [];
      for (const u of users) {
        const subId = u.premiumSubscriptionId;
        if (!subId || typeof subId !== 'string') continue;
        try {
          const subscription = await this.stripeSvc.stripe.subscriptions.retrieve(subId) as any;
          if (!subscription) continue;
          const periodEnd =
            subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : await this.stripeSvc.resolveSubscriptionPeriodEnd(subscription);

          const expectedStatus = subscription.status || null;

          const reconciled = reconcileEntitlements(
            {
              ...(u as any),
              premiumSubscriptionId: subId,
              premiumSubscriptionStatus: expectedStatus,
              premiumSubscriptionUntil: periodEnd,
            },
            now,
          );

          const update: any = {
            premiumSubscriptionId: subId,
            premiumSubscriptionStatus: expectedStatus,
            premiumSubscriptionUntil: periodEnd,

            jarExpiresAt: reconciled.jarExpiresAt,
            jarRemainingMs: reconciled.jarRemainingMs,

            premiumUntil: reconciled.premiumUntil,
            isPremium: reconciled.isPremium,
            planType: reconciled.planType,
          };

          if ('premiumBonusDays' in reconciled) update.premiumBonusDays = reconciled.premiumBonusDays;
          if ('premiumSubscriptionId' in reconciled) update.premiumSubscriptionId = reconciled.premiumSubscriptionId;
          if ('premiumSubscriptionStatus' in reconciled) update.premiumSubscriptionStatus = reconciled.premiumSubscriptionStatus;
          if ('premiumSubscriptionUntil' in reconciled) update.premiumSubscriptionUntil = reconciled.premiumSubscriptionUntil;

          bulkOps.push({ updateOne: { filter: { _id: u._id }, update: { $set: update } } });
        } catch (err: any) {
          this.logger.warn(`[verifySubscriptions] Error recuperando sub ${subId}: ${err?.message}`);
          continue;
        }
      }

      if (bulkOps.length > 0) {
        const res = await this.userModel.bulkWrite(bulkOps, { ordered: false });
        const updated = (res as any).modifiedCount ?? (res as any).nModified ?? 0;
        this.logger.log(`🔧 Sincronizadas: ${updated} suscripciones`);
      } else {
        this.logger.log('✅ Ninguna actualización necesaria después de verificar subs');
      }
    } catch (err: any) {
      this.logger.error('❌ Error en verifySubscriptions: ' + err?.message);
    }
  }
}
