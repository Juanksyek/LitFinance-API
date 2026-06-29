import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

type Bucket = {
  resetAt: number;
  count: number;
};

@Injectable()
export class AuthRateLimitService {
  private readonly localBuckets = new Map<string, Bucket>();
  private readonly windowMs = 60_000;
  private readonly limits = {
    login: 5,
    register: 3,
  } as const;

  constructor(private readonly redis: RedisService) {}

  async check(
    scope: keyof typeof this.limits,
    keySeed: string,
  ): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    const key = `lf:rl:auth:${scope}:${keySeed || 'anonymous'}`;
    const limit = this.limits[scope];

    if (this.redis.isReady) {
      return this.checkRedis(key, limit);
    }

    return this.checkLocal(key, limit);
  }

  private async checkRedis(
    key: string,
    limit: number,
  ): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    const count = await this.redis.incr(key);
    if (count === null) return { allowed: true };

    if (count === 1) {
      await this.redis.pexpire(key, this.windowMs);
    }

    if (count > limit) {
      const remaining = await this.redis.pttl(key);
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(Math.max(0, remaining) / 1000),
      };
    }

    return { allowed: true };
  }

  private checkLocal(
    key: string,
    limit: number,
  ): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = Date.now();
    const existing = this.localBuckets.get(key);

    if (!existing || now >= existing.resetAt) {
      this.localBuckets.set(key, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return { allowed: true };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(Math.max(0, existing.resetAt - now) / 1000),
      };
    }

    existing.count += 1;
    return { allowed: true };
  }
}
