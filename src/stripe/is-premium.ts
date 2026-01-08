export function isPremium(user: any) {
  const now = Date.now();
  const subOk =
    (user?.premiumSubscriptionStatus === 'active' || user?.premiumSubscriptionStatus === 'trialing') &&
    user?.premiumSubscriptionUntil &&
    new Date(user.premiumSubscriptionUntil).getTime() > now;

  const jarOk =
    (user?.jarExpiresAt && new Date(user.jarExpiresAt).getTime() > now) ||
    // Safety: if Jar is paused but no subscription is entitled, treat remaining as premium
    (!subOk && Number(user?.jarRemainingMs || 0) > 0);

  return !!(subOk || jarOk);
}
