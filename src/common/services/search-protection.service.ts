import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { TooManyRequestsException } from '../exceptions/too-many-requests.exception';
import { RedisService } from '../../redis/redis.service';

type Bucket = {
  resetAt: number;
  count: number;
};

@Injectable()
export class SearchProtectionService {
  private readonly localBuckets = new Map<string, Bucket>();
  private readonly minChars = 2;
  private readonly windowMs = 60_000;
  private readonly limit = 20;

  constructor(private readonly redis: RedisService) {}

  async guard(params: {
    search?: string;
    tracker: string;
    scope: string;
  }): Promise<void> {
    const raw = String(params.search ?? '').trim();
    if (!raw) return;

    if (raw.length < this.minChars) {
      throw new BadRequestException({
        code: 'SEARCH_QUERY_TOO_SHORT',
        message: `search debe tener al menos ${this.minChars} caracteres`,
      });
    }

    const keySeed = `${params.scope}:${params.tracker}`;
    const result = this.redis.isReady
      ? await this.checkRedis(keySeed)
      : this.checkLocal(keySeed);

    if (!result.allowed) {
      throw new TooManyRequestsException({
        code: 'RATE_LIMITED',
        message: 'Too Many Requests',
        details: {
          retryAfterSeconds: result.retryAfterSeconds,
        },
      });
    }
  }

  private async checkRedis(
    keySeed: string,
  ): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    const key = `lf:rl:search:${keySeed}`;
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

  private checkLocal(
    key: string,
  ): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = Date.now();
    const existing = this.localBuckets.get(key);

    if (!existing || now >= existing.resetAt) {
      this.localBuckets.set(key, { count: 1, resetAt: now + this.windowMs });
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
