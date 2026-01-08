import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { Model } from 'mongoose';
import { User, UserDocument } from '../src/user/schemas/user.schema/user.schema';
import { reconcileEntitlements } from '../src/user/premium-entitlements';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const userModel = app.get<Model<UserDocument>>('UserModel');

    const apply = process.argv.includes('--apply');
    const limitArgIndex = process.argv.indexOf('--limit');
    const limit = limitArgIndex >= 0 ? Number(process.argv[limitArgIndex + 1]) || 200 : 200;

    console.log(`Migration dry-run=${!apply} limit=${limit}`);

    const query = {
      $or: [
        { premiumUntil: { $exists: true } },
        { premiumBonusDays: { $exists: true } },
        { premiumSubscriptionId: 'tipjar' },
      ],
    };

    const users = await userModel.find(query).limit(limit).lean();
    console.log(`Found ${users.length} users matching legacy patterns (preview)`);

    const now = new Date();
    const ops: any[] = [];
    let changed = 0;

    for (const u of users) {
      const reconciled = reconcileEntitlements(u as any, now as Date);

      const update: any = {
        jarExpiresAt: reconciled.jarExpiresAt,
        jarRemainingMs: reconciled.jarRemainingMs,
        premiumUntil: reconciled.premiumUntil,
        isPremium: reconciled.isPremium,
        planType: reconciled.planType,
      };

      if ('premiumSubscriptionId' in reconciled) update.premiumSubscriptionId = reconciled.premiumSubscriptionId;
      if ('premiumSubscriptionStatus' in reconciled) update.premiumSubscriptionStatus = reconciled.premiumSubscriptionStatus;
      if ('premiumSubscriptionUntil' in reconciled) update.premiumSubscriptionUntil = reconciled.premiumSubscriptionUntil;
      if ('premiumBonusDays' in reconciled) update.premiumBonusDays = reconciled.premiumBonusDays;

      // Detect no-op
      const dirty =
        String(u.jarExpiresAt || '') !== String(update.jarExpiresAt || '') ||
        Number(u.jarRemainingMs || 0) !== Number(update.jarRemainingMs || 0) ||
        String(u.premiumUntil || '') !== String(update.premiumUntil || '') ||
        Boolean(u.isPremium) !== Boolean(update.isPremium);

      if (dirty) {
        changed++;
        console.log(`Will update user ${u._id}: premiumUntil=${update.premiumUntil} isPremium=${update.isPremium} jarExpiresAt=${update.jarExpiresAt} jarRemainingMs=${update.jarRemainingMs}`);
        if (apply) {
          ops.push({ updateOne: { filter: { _id: u._id }, update: { $set: update } } });
        }
      }
    }

    console.log(`Preview: ${changed} users would be updated`);

    if (apply && ops.length > 0) {
      const res = await userModel.bulkWrite(ops, { ordered: false });
      console.log('Applied updates:', res);
    }

    if (!apply) {
      console.log('\nDry-run complete. To apply changes run:');
      console.log('  npx ts-node -r tsconfig-paths/register scripts/migrate-normalize-premium.ts --apply --limit 500');
    }
  } catch (err: any) {
    console.error('Migration error:', err?.message || err);
    process.exitCode = 2;
  } finally {
    await app.close();
  }
}

main();
