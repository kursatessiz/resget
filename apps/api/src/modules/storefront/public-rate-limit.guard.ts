import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RedisService } from '../redis/redis.service';
import { forbidden } from '../../common/api-error';

export const RATE_LIMIT_KEY = 'public_rate_limit';
export interface RateLimitRule {
  /** Logical bucket; one counter per bucket and client. */
  bucket: string;
  /** Requests allowed per window; overridden by PUBLIC_<BUCKET>_RATE_LIMIT when set. */
  limit: number;
  windowSeconds: number;
}
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);

/**
 * Per-client limit on unauthenticated writes (order placement, funnel
 * steps). Counts in Redis when it is configured so every API instance
 * shares the window; otherwise in process memory. The client is the first
 * forwarded address (Caddy sits in front) or the socket address.
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const limit = this.config.get<number>(`PUBLIC_${rule.bucket.toUpperCase()}_RATE_LIMIT`) ?? rule.limit;
    const key = `rl:${rule.bucket}:${clientOf(request)}`;
    const count = await this.increment(key, rule.windowSeconds);
    if (count > limit) throw forbidden('RATE_LIMITED', 'Too many requests');
    return true;
  }

  private async increment(key: string, windowSeconds: number): Promise<number> {
    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const count = await client.incr(key);
        if (count === 1) await client.expire(key, windowSeconds);
        return count;
      } catch {
        // Redis unavailable: fall through to the in-memory window rather than refusing every order.
      }
    }
    const now = Date.now();
    const entry = this.memory.get(key);
    if (!entry || entry.resetAt <= now) {
      this.memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      if (this.memory.size > 10_000) this.sweep(now);
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.memory) if (entry.resetAt <= now) this.memory.delete(key);
  }
}

function clientOf(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first ?? request.ip ?? 'unknown').trim();
}
