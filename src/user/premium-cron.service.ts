import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema/user.schema';
import { reconcileEntitlements } from './premium-entitlements';

@Injectable()
export class PremiumCronService {
  private readonly logger = new Logger(PremiumCronService.name);

  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async onModuleInit() {
    try {
      // Create index to speed up reconciliation queries (idempotent)
      await this.userModel.collection.createIndex({ premiumUntil: 1, isPremium: 1 });
      await this.userModel.collection.createIndex({ premiumSubscriptionUntil: 1, premiumSubscriptionStatus: 1 });
      await this.userModel.collection.createIndex({ jarExpiresAt: 1, jarRemainingMs: 1 });
      await this.userModel.collection.createIndex({ planType: 1, isPremium: 1 });
      this.logger.log('🔎 Índices creados/comprobados para reconciliación premium/jar');
    } catch (err: any) {
      this.logger.warn('⚠️ No se pudo crear el índice de premium: ' + err?.message);
    }
  }

  /**
   * Reconciliación ligera de `isPremium` cada hora.
   * - Busca usuarios con `premiumUntil` definido donde `isPremium` esté desincronizado
   * - Usa `bulkWrite` para minimizar operaciones y carga
   */
  @Cron('0 * * * *', { timeZone: 'America/Mexico_City' }) // cada hora en minuto 0
  async reconcilePremiumStatus() {
    this.logger.log('🔁 Ejecutando reconciliación horaria de premium status...');
    try {
      const now = new Date();

      // Buscar sólo candidatos con señales de desincronización o legacy
      const candidates = await this.userModel
        .find({
          $or: [
            // planType desincronizado
            { $and: [{ isPremium: true }, { planType: 'free_plan' }] },
            { $and: [{ isPremium: false }, { planType: 'premium_plan' }] },

            // legacy tipjar / bonus
            { premiumSubscriptionId: 'tipjar' },
            { premiumBonusDays: { $gt: 0 } },

            // Jar debería estar pausado cuando la suscripción está activa/trialing
            { $and: [{ premiumSubscriptionStatus: { $in: ['active', 'trialing'] } }, { jarExpiresAt: { $exists: true, $ne: null } }] },

            // Jar debería reanudarse cuando no hay suscripción premium
            { $and: [{ premiumSubscriptionStatus: { $nin: ['active', 'trialing'] } }, { jarRemainingMs: { $gt: 0 } }, { $or: [{ jarExpiresAt: null }, { jarExpiresAt: { $exists: false } }] }] },

            // isPremium / premiumUntil potencialmente desincronizados
            { $and: [{ premiumUntil: { $lte: now } }, { isPremium: true }] },
            { $and: [{ premiumUntil: { $gt: now } }, { isPremium: false }] },
          ],
        })
        .select(
          '_id premiumSubscriptionId premiumSubscriptionStatus premiumSubscriptionUntil ' +
            'jarExpiresAt jarRemainingMs premiumUntil isPremium planType premiumBonusDays',
        )
        .limit(500)
        .lean();

      if (!candidates || candidates.length === 0) {
        this.logger.log('✅ No hay usuarios desincronizados');
        return;
      }

      const bulkOps: any[] = [];
      for (const u of candidates) {
        const reconciled = reconcileEntitlements(u as any, now);
        const update: any = {
          isPremium: reconciled.isPremium,
          planType: reconciled.planType,
          premiumUntil: reconciled.premiumUntil,
          jarExpiresAt: reconciled.jarExpiresAt,
          jarRemainingMs: reconciled.jarRemainingMs,
        };
        if ('premiumSubscriptionId' in reconciled) update.premiumSubscriptionId = reconciled.premiumSubscriptionId;
        if ('premiumSubscriptionStatus' in reconciled) update.premiumSubscriptionStatus = reconciled.premiumSubscriptionStatus;
        if ('premiumSubscriptionUntil' in reconciled) update.premiumSubscriptionUntil = reconciled.premiumSubscriptionUntil;
        if ('premiumBonusDays' in reconciled) update.premiumBonusDays = reconciled.premiumBonusDays;

        bulkOps.push({ updateOne: { filter: { _id: u._id }, update: { $set: update } } });
      }

      if (bulkOps.length > 0) {
        const res = await this.userModel.bulkWrite(bulkOps, { ordered: false });
        const updatedCount = (res as any).modifiedCount ?? (res as any).nModified ?? 0;
        this.logger.log(`🔧 Actualizados: ${updatedCount} usuarios`);
      } else {
        this.logger.log('✅ Ninguna actualización necesaria después de evaluación');
      }
    } catch (err: any) {
      this.logger.error('❌ Error en reconcilePremiumStatus: ' + err?.message);
    }
  }
}
