const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanType = 'free_plan' | 'premium_plan';

export function isSubscriptionEntitled(status?: string | null) {
  return status === 'active' || status === 'trialing';
}

function asDateOrNull(value: any): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function clampNonNegativeMs(ms: number) {
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export type ReconcileInputUser = {
  premiumSubscriptionStatus?: string | null;
  premiumSubscriptionUntil?: Date | string | null;
  premiumSubscriptionId?: string | null;

  jarExpiresAt?: Date | string | null;
  jarRemainingMs?: number | null;

  // legacy
  premiumBonusDays?: number | null;
  premiumUntil?: Date | string | null;
  planType?: string | null;
  isPremium?: boolean | null;
};

export type ReconcileResult = {
  isPremium: boolean;
  planType: PlanType;
  premiumUntil: Date | null;

  jarExpiresAt: Date | null;
  jarRemainingMs: number;

  // legacy cleanup helpers
  premiumSubscriptionId?: string | null;
  premiumSubscriptionStatus?: string | null;
  premiumSubscriptionUntil?: Date | null;
  premiumBonusDays?: number;
};

export function msFromJarDays(days: number) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.round(d * DAY_MS);
}

/**
 * Reconciles Jar vs subscription rules:
 * - Subscription (active/trialing) has priority.
 * - If subscription is entitled, Jar is paused (jarExpiresAt -> jarRemainingMs).
 * - If subscription is NOT entitled, Jar is resumed (jarRemainingMs -> jarExpiresAt).
 * - premiumUntil/isPremium/planType are derived and made consistent.
 *
 * Also performs safe legacy normalization:
 * - premiumSubscriptionId === 'tipjar' is treated as NOT a real subscription.
 */
export function reconcileEntitlements(user: ReconcileInputUser, now = new Date()): ReconcileResult {
  const hasRealSubId = !!user.premiumSubscriptionId && user.premiumSubscriptionId !== 'tipjar';
  const premiumSubscriptionId = hasRealSubId ? String(user.premiumSubscriptionId) : null;
  const premiumSubscriptionStatus = hasRealSubId ? (user.premiumSubscriptionStatus ?? null) : null;
  const premiumSubscriptionUntil = hasRealSubId ? asDateOrNull(user.premiumSubscriptionUntil) : null;

  let jarExpiresAt = asDateOrNull(user.jarExpiresAt);
  let jarRemainingMs = clampNonNegativeMs(Number(user.jarRemainingMs ?? 0));

  // Legacy: if we have no new Jar fields but have premiumUntil with a 'tipjar' marker or no subscription, treat it as jarExpiresAt.
  if (!jarExpiresAt && jarRemainingMs === 0) {
    const legacyPremiumUntil = asDateOrNull(user.premiumUntil);
    const looksLikeJarOnly = !premiumSubscriptionId && (user.premiumSubscriptionId === 'tipjar' || !user.premiumSubscriptionStatus);
    if (legacyPremiumUntil && looksLikeJarOnly) {
      jarExpiresAt = legacyPremiumUntil;
    }
  }

  // Legacy: premiumBonusDays becomes paused Jar time (ms). Do NOT apply to subscription periods.
  const legacyBonusDays = Number(user.premiumBonusDays ?? 0);
  if (Number.isFinite(legacyBonusDays) && legacyBonusDays > 0) {
    jarRemainingMs += msFromJarDays(legacyBonusDays);
  }

  // Expired jarExpiresAt should not linger.
  if (jarExpiresAt && jarExpiresAt.getTime() <= now.getTime()) {
    jarExpiresAt = null;
  }

  const subEntitled =
    isSubscriptionEntitled(premiumSubscriptionStatus) &&
    !!premiumSubscriptionUntil &&
    premiumSubscriptionUntil.getTime() > now.getTime();

  // Pause / Resume jar
  if (subEntitled) {
    if (jarExpiresAt) {
      const remaining = jarExpiresAt.getTime() - now.getTime();
      jarRemainingMs += clampNonNegativeMs(remaining);
      jarExpiresAt = null;
    }
  } else {
    if (!jarExpiresAt && jarRemainingMs > 0) {
      jarExpiresAt = new Date(now.getTime() + jarRemainingMs);
      jarRemainingMs = 0;
    }
  }

  const jarEntitled = !!jarExpiresAt && jarExpiresAt.getTime() > now.getTime();

  const premiumUntil = subEntitled
    ? premiumSubscriptionUntil!
    : (jarEntitled ? jarExpiresAt! : null);

  const isPremium = !!premiumUntil && premiumUntil.getTime() > now.getTime();
  const planType: PlanType = isPremium ? 'premium_plan' : 'free_plan';

  const result: ReconcileResult = {
    isPremium,
    planType,
    premiumUntil,
    jarExpiresAt,
    jarRemainingMs,
  };

  // If we detected legacy tipjar markers, clear them.
  if (user.premiumSubscriptionId === 'tipjar') {
    result.premiumSubscriptionId = null;
    result.premiumSubscriptionStatus = null;
    result.premiumSubscriptionUntil = null;
  }

  // If we consumed legacy premiumBonusDays into Jar, zero it out.
  if (legacyBonusDays > 0) {
    result.premiumBonusDays = 0;
  }

  return result;
}

/**
 * Adds Jar credit in a way that respects pause/resume rules.
 *
 * - If subscription is entitled: add time to jarRemainingMs (paused balance).
 * - Else: extend jarExpiresAt if running, or start it from now.
 */
export function applyJarCredit(user: ReconcileInputUser, addMs: number, now = new Date()) {
  const ms = clampNonNegativeMs(Number(addMs));
  if (ms <= 0) return reconcileEntitlements(user, now);

  // Start from reconciled baseline (also normalizes legacy fields)
  const base = reconcileEntitlements(user, now);

  const subEntitled =
    isSubscriptionEntitled(user.premiumSubscriptionStatus) &&
    !!asDateOrNull(user.premiumSubscriptionUntil) &&
    asDateOrNull(user.premiumSubscriptionUntil)!.getTime() > now.getTime() &&
    !!user.premiumSubscriptionId &&
    user.premiumSubscriptionId !== 'tipjar';

  let jarExpiresAt = base.jarExpiresAt;
  let jarRemainingMs = base.jarRemainingMs;

  if (subEntitled) {
    jarRemainingMs += ms;
  } else {
    if (jarExpiresAt && jarExpiresAt.getTime() > now.getTime()) {
      jarExpiresAt = new Date(jarExpiresAt.getTime() + ms);
    } else {
      jarExpiresAt = new Date(now.getTime() + ms);
    }
  }

  return reconcileEntitlements(
    {
      ...user,
      jarExpiresAt,
      jarRemainingMs,
      premiumBonusDays: 0,
    },
    now,
  );
}
