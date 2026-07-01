import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'events';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private _ready = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // Increase the default max listeners to avoid the
    // "MaxListenersExceededWarning" on environments that create
    // multiple TLS sockets (e.g. reconnects, hot-reload, or many inbound
    // handlers). 20 is a reasonable safe default.
    EventEmitter.defaultMaxListeners = Math.max(EventEmitter.defaultMaxListeners || 0, 20);

    const url = this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';

    // Guard against re-initialization (can happen with some dev setups)
    if (this.client) {
      this.logger.log('Redis client already initialized; skipping re-init');
      return;
    }

    this.client = new Redis(url, {
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        // Exponential backoff capped at 10 s; stop after 5 attempts
        if (times > 5) return null;
        return Math.min(times * 500, 10_000);
      },
      reconnectOnError: () => true,
    });

    // Also set instance-level listeners cap if available
    try {
      // ioredis instance extends EventEmitter; setMaxListeners may be present.
      (this.client as any).setMaxListeners?.(20);
    } catch {
      // noop
    }

    this.client.on('ready', () => {
      this._ready = true;
      this.logger.log('Redis connected');
    });

    this.client.on('error', (err) => {
      this._ready = false;
      this.logger.warn(`Redis error – operating without cache: ${err.message}`);
    });

    this.client.on('close', () => {
      this._ready = false;
    });

    // Non-blocking connect
    this.client.connect().catch(() => {
      this.logger.warn('Redis unavailable on startup – will retry in background');
    });
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => {});
  }

  // ─────────────────────────────────────────────
  // Core helpers (all methods fail-safe: if Redis
  // is down they return null / no-op)
  // ─────────────────────────────────────────────

  get isReady(): boolean {
    return this._ready;
  }

  async get<T = string>(key: string): Promise<T | null> {
    if (!this._ready) return null;
    try {
      const raw = await this.client.get(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this._ready) return;
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      await this.client.set(key, serialized, 'EX', ttlSeconds);
    } catch {
      // fail-safe
    }
  }

  async del(key: string): Promise<void> {
    if (!this._ready) return;
    try {
      await this.client.del(key);
    } catch {
      // fail-safe
    }
  }

  /**
   * Deletes all keys matching a glob pattern using SCAN (non-blocking).
   * Use for cache invalidation patterns like `lf:snap:userId:*`.
   */
  async scanDel(pattern: string): Promise<void> {
    if (!this._ready) return;
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } while (cursor !== '0');
    } catch {
      // fail-safe
    }
  }

  /**
   * Atomically increment an integer key and return the new value.
   * Used for rate-limiting counters.
   */
  async incr(key: string): Promise<number | null> {
    if (!this._ready) return null;
    try {
      return await this.client.incr(key);
    } catch {
      return null;
    }
  }

  /**
   * Set expiry in milliseconds (pexpire).
   */
  async pexpire(key: string, ms: number): Promise<void> {
    if (!this._ready) return;
    try {
      await this.client.pexpire(key, ms);
    } catch {
      // fail-safe
    }
  }

  /**
   * Time-to-live in milliseconds. Returns -2 if key doesn't exist.
   */
  async pttl(key: string): Promise<number> {
    if (!this._ready) return -2;
    try {
      return await this.client.pttl(key);
    } catch {
      return -2;
    }
  }

  async ping(timeoutMs = 1000): Promise<boolean> {
    if (!this._ready) return false;

    try {
      const result = await Promise.race([
        this.client.ping(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Redis ping timeout')), timeoutMs),
        ),
      ]);

      return result === 'PONG';
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // Domain helpers
  // ─────────────────────────────────────────────

  /** Invalidates all dashboard-related cache for a given user. */
  async invalidateUserDashboard(userId: string): Promise<void> {
    await Promise.all([
      this.del(`lf:version:${userId}`),
      this.scanDel(`lf:snap:${userId}:*`),
      this.invalidateUserMobileBootstrap(userId),
    ]);
  }

  /** Invalidates all mobile bootstrap cache for a given user. */
  async invalidateUserMobileBootstrap(userId: string): Promise<void> {
    await this.scanDel(`lf:mobile:bootstrap:${userId}:*`);
  }
}
