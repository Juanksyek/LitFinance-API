import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly redisService: RedisService,
  ) {}

  getLiveness() {
    return {
      status: 'ok',
      service: 'LitFinance API',
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      uptimeSeconds: Math.round(process.uptime()),
      serverTime: new Date().toISOString(),
    };
  }

  async getDeepHealth() {
    const [mongo, redis] = await Promise.all([
      this.checkMongo(),
      this.checkRedis(),
    ]);

    const allHealthy = mongo.status === 'ok' && redis.status === 'ok';

    return {
      status: allHealthy ? 'ok' : 'degraded',
      service: 'LitFinance API',
      serverTime: new Date().toISOString(),
      checks: {
        mongo,
        redis,
      },
    };
  }

  private async checkMongo() {
    try {
      const db = this.connection.db;
      if (!db) {
        return {
          status: 'error',
          message: 'Mongo connection unavailable',
        };
      }

      await db.admin().ping();
      return { status: 'ok' };
    } catch (error: any) {
      return {
        status: 'error',
        message: error?.message ?? 'Mongo ping failed',
      };
    }
  }

  private async checkRedis() {
    try {
      const ready = await this.redisService.ping();
      if (!ready) {
        return {
          status: 'error',
          message: 'Redis unavailable',
        };
      }

      return { status: 'ok' };
    } catch (error: any) {
      return {
        status: 'error',
        message: error?.message ?? 'Redis ping failed',
      };
    }
  }
}
