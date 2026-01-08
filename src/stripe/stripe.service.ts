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

  /**
   * Intenta resolver current_period_end para una suscripción.
   * Estrategia:
   * 1) Si la suscripción ya tiene `current_period_end`, úsalo.
   * 2) Lista los últimos invoices asociados a la suscripción y busca `lines.data[*].period.end`.
   * 3) Si no se encuentra, devuelve null.
   */
  async resolveSubscriptionPeriodEnd(subscriptionOrId: any): Promise<Date | null> {
    try {
      let sub: any = subscriptionOrId;
      if (!sub) return null;
      if (typeof sub === 'string') {
        sub = await this.stripe.subscriptions.retrieve(sub);
      }

      if (sub?.current_period_end) {
        return new Date(sub.current_period_end * 1000);
      }

      // Buscar invoices recientes de la suscripción
      const invoices = await this.stripe.invoices.list({ subscription: sub.id, limit: 5 });
      if (invoices && Array.isArray(invoices.data) && invoices.data.length > 0) {
        // priorizar invoices pagadas
        const sorted = invoices.data.sort((a: any, b: any) => (b.created || 0) - (a.created || 0));
        for (const inv of sorted) {
          // intentamos extraer period end desde las líneas
          if (inv.lines && Array.isArray(inv.lines.data) && inv.lines.data.length > 0) {
            for (const li of inv.lines.data) {
              const pe = li?.period?.end;
              if (pe) return new Date(pe * 1000);
            }
          }
          // Fallback: algunos invoices exponen `period_end` en root (según versión)
          if ((inv as any).period_end) return new Date((inv as any).period_end * 1000);
        }
      }
    } catch (err) {
      // no lanzar; devolver null y dejar que el reconciliador decida
    }
    return null;
  }
}
