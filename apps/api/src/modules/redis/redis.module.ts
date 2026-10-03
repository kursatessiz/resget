import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RateLimiterService } from './rate-limiter.service';

@Global()
@Module({
  providers: [RedisService, RateLimiterService],
  exports: [RedisService, RateLimiterService],
})
export class RedisModule {}
