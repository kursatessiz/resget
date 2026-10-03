import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_KEY_HEADER } from '@resget/shared';
import { forbidden, unauthorized } from '../../../common/api-error';
import { RateLimiterService } from '../../redis/rate-limiter.service';
import { ApiKeysService } from '../api-keys.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from '../tenant-context';

/**
 * Restaurant-scoped routes take either a session (bearer JWT) or a restaurant
 * API key (docs/API_ERISIMI.md). A presented key must be valid; it never falls
 * back to the session so a typo in a key cannot silently act as someone else.
 */
@Injectable()
export class ApiKeyOrJwtAuthGuard extends JwtAuthGuard {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly limiter: RateLimiterService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers[API_KEY_HEADER];
    const token = Array.isArray(header) ? header[0] : header;
    if (token === undefined) return (await super.canActivate(context)) as boolean;
    const principal = await this.apiKeys.authenticate(token);
    if (!principal) throw unauthorized('Invalid API key');
    // One window per key, not per client address: an integration behind many addresses is still one caller.
    const limit = this.config.get<number>('API_KEY_RATE_LIMIT') ?? 600;
    if ((await this.limiter.hit(`rl:apikey:${principal.keyId}`, 60)) > limit)
      throw forbidden('RATE_LIMITED', 'API key rate limit exceeded');
    request.user = principal.user;
    request.apiKey = principal;
    return true;
  }
}
