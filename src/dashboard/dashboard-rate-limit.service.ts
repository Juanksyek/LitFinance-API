import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

type Bucket = {
  resetAt: number;
  count: number;
};

@Injectable()
export class DashboardRateLimitService {
  /** Fallback in-memory store used when Redis is unavailable. */
  private readonly localBuckets = new Map<string, Bucket>();

  // Snapshot es tu endpoint principal: lo hacemos "amigable".
  // Ejemplo: 12 requests cada 10s por usuario.
  private readonly windowMs = 10_000;
  private readonly limit = 12;

  constructor(private readonly redis: RedisService) {}

  /**
   * Retorna null si está permitido, o el retryAfterSeconds si excede.
   * Uses Redis INCR + PEXPIRE for distributed rate limiting.
   * Falls back to an in-memory counter when Redis is unavailable.
   */
  async check(userId: string): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    const key = `lf:rl:dash:${userId || 'anonymous'}`;

    if (this.redis.isReady) {
      return this.checkRedis(key);
    }
    return this.checkLocal(userId || 'anonymous');
  }

  private async checkRedis(key: string): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    const count = await this.redis.incr(key);
    if (count === null) {
      // Redis call failed mid-op; allow the request
      return { allowed: true };
    }

    if (count === 1) {
      // First request in window; set the expiry
      await this.redis.pexpire(key, this.windowMs);
    }

    if (count > this.limit) {
      const remaining = await this.redis.pttl(key);
      const retryAfterSeconds = Math.ceil(Math.max(0, remaining) / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    return { allowed: true };
  }

  private checkLocal(userId: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = Date.now();
    const existing = this.localBuckets.get(userId);

    if (!existing || now >= existing.resetAt) {
      this.localBuckets.set(userId, { resetAt: now + this.windowMs, count: 1 });
      return { allowed: true };
    }

    if (existing.count >= this.limit) {
      const retryMs = Math.max(0, existing.resetAt - now);
      return { allowed: false, retryAfterSeconds: Math.ceil(retryMs / 1000) };
    }

    existing.count += 1;
    return { allowed: true };
  }
}
