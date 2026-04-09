import { Injectable } from '@nestjs/common';

type Bucket = {
  resetAt: number;
  count: number;
};

@Injectable()
export class DashboardRateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  // Snapshot es tu endpoint principal: lo hacemos "amigable".
  // Ejemplo: 12 requests cada 10s por usuario.
  private readonly windowMs = 10_000;
  private readonly limit = 12;

  /**
   * Retorna null si está permitido, o el retryAfterSeconds si excede.
   */
  check(userId: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = Date.now();
    const key = userId || 'anonymous';
    const existing = this.buckets.get(key);

    if (!existing || now >= existing.resetAt) {
      this.buckets.set(key, { resetAt: now + this.windowMs, count: 1 });
      return { allowed: true };
    }

    if (existing.count >= this.limit) {
      const retryMs = Math.max(0, existing.resetAt - now);
      const retryAfterSeconds = Math.ceil(retryMs / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    existing.count += 1;
    return { allowed: true };
  }
}
