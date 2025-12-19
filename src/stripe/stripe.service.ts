import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  public stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: (process.env.STRIPE_API_VERSION as any) || '2024-06-20',
    });
  }

  giftDaysForJar(amountMXN: number) {
    if (amountMXN >= 200) return 90;
    if (amountMXN >= 100) return 30;
    if (amountMXN >= 50) return 15;
    if (amountMXN >= 20) return 7;
    return 0;
  }

  extendPremiumUntil(current: Date | null | undefined, daysToAdd: number) {
    const base = current && current.getTime() > Date.now() ? current : new Date();
    const next = new Date(base);
    next.setDate(next.getDate() + daysToAdd);
    return next;
  }
}
