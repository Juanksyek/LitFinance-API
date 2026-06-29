import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

type Bucket = {
  resetAt: number;
  count: number;
};

@Injectable()
export class MobileRateLimitService {
  private readonly localBuckets = new Map<string, Bucket>();
  private readonly windowMs = 60_000;
  private readonly limit = 20;

  constructor(private readonly redis: RedisService) {}

  async check(
    keySeed: string,
    scope = 'bootstrap',
  ): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    const key = `lf:rl:mobile:${scope}:${keySeed || 'anonymous'}`;

    if (this.redis.isReady) {
      return this.checkRedis(key);
    }

    return this.checkLocal(key);
  }

  private async checkRedis(key: string): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    const count = await this.redis.incr(key);
    if (count === null) return { allowed: true };

    if (count === 1) {
      await this.redis.pexpire(key, this.windowMs);
    }

    if (count > this.limit) {
      const remaining = await this.redis.pttl(key);
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(Math.max(0, remaining) / 1000),
      };
    }

    return { allowed: true };
  }

  private checkLocal(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = Date.now();
    const existing = this.localBuckets.get(key);

    if (!existing || now >= existing.resetAt) {
      this.localBuckets.set(key, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return { allowed: true };
    }

    if (existing.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(Math.max(0, existing.resetAt - now) / 1000),
      };
    }

    existing.count += 1;
    return { allowed: true };
  }
}
