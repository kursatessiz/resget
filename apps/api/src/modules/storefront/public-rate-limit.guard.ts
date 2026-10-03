import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RateLimiterService } from '../redis/rate-limiter.service';
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
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
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
    const count = await this.limiter.hit(`rl:${rule.bucket}:${clientOf(request)}`, rule.windowSeconds);
    if (count > limit) throw forbidden('RATE_LIMITED', 'Too many requests');
    return true;
  }
}

function clientOf(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first ?? request.ip ?? 'unknown').trim();
}
