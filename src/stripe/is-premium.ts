export function isPremium(user: any) {
  const subOk = user?.premiumSubscriptionStatus === 'active' || user?.premiumSubscriptionStatus === 'trialing';
  const jarOk = user?.premiumUntil && new Date(user.premiumUntil).getTime() > Date.now();
  return subOk || jarOk;
}
