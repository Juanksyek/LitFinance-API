import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Global Redis module – mark it @Global() so every feature module can inject
 * RedisService without needing to import RedisModule explicitly.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
