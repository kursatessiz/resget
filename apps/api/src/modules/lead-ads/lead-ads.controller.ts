import { Controller, Get, HttpCode, Logger, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  LeadAdsQuerySchema,
  MetaPageWebhookSchema,
  UpdateLeadAdsPageSchema,
  UuidSchema,
  leadgenNotices,
} from '@resget/shared';
import type {
  LeadAdsQuery,
  MetaLeadDTO,
  MetaLeadPageDTO,
  SocialAccountDTO,
  UpdateLeadAdsPageInput,
} from '@resget/shared';
import { badRequest } from '../../common/api-error';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { LeadAdsService } from './lead-ads.service';

/** Lead import of a tenant's connected pages (docs/LEAD_ADS.md). */
@Controller('restaurants/:restaurantId/lead-ads')
@RestaurantScoped()
@RequireFeature('lead_ads')
export class LeadAdsController {
  constructor(private readonly leads: LeadAdsService) {}

  @Put('pages/:accountId')
  @RequirePermission('integrations.manage')
  setPage(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('accountId', UuidSchema) accountId: string,
    @ZodBody(UpdateLeadAdsPageSchema) body: UpdateLeadAdsPageInput,
  ): Promise<SocialAccountDTO> {
    return this.leads.setPage(tenant.restaurantId, accountId, user.id, body.enabled);
  }

  @Get('leads')
  @RequirePermission('customers.view')
  list(@Tenant() tenant: TenantContext, @ZodQuery(LeadAdsQuerySchema) query: LeadAdsQuery): Promise<MetaLeadPageDTO> {
    return this.leads.list(tenant.restaurantId, query.page);
  }

  @Post('leads/:leadId/retry')
  @HttpCode(200)
  @RequirePermission('integrations.manage')
  retry(@Tenant() tenant: TenantContext, @ZodParam('leadId', UuidSchema) leadId: string): Promise<MetaLeadDTO> {
    return this.leads.retry(tenant.restaurantId, leadId);
  }
}

/**
 * Meta's page webhook (docs/LEAD_ADS.md). The GET answers the setup
 * challenge; the POST is read only after its X-Hub-Signature-256 matches the
 * raw body under the app secret.
 */
@Controller('webhooks/meta')
@UseGuards(PublicRateLimitGuard)
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(private readonly leads: LeadAdsService) {}

  @Get()
  @RateLimit({ bucket: 'meta_webhook', limit: 60, windowSeconds: 600 })
  challenge(@Query() query: Record<string, unknown>, @Res() res: Response): void {
    const challenge = this.leads.verifyChallenge(
      single(query['hub.mode']),
      single(query['hub.verify_token']),
      single(query['hub.challenge']),
    );
    if (challenge === null) {
      res.status(403).end();
      return;
    }
    res.status(200).type('text/plain').send(challenge);
  }

  @Post()
  @HttpCode(200)
  @RateLimit({ bucket: 'meta_webhook', limit: 600, windowSeconds: 60 })
  async deliver(@Req() req: RawBodyRequest<Request>): Promise<{ received: number }> {
    const signature = req.headers['x-hub-signature-256'];
    if (!this.leads.verifySignature(req.rawBody, typeof signature === 'string' ? signature : undefined)) {
      this.logger.warn('Meta webhook with an invalid signature dropped');
      throw badRequest('WEBHOOK_INVALID', 'Signature or payload rejected');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(req.rawBody?.toString('utf8') ?? '');
    } catch {
      throw badRequest('WEBHOOK_INVALID', 'Signature or payload rejected');
    }
    const parsed = MetaPageWebhookSchema.safeParse(payload);
    if (!parsed.success) throw badRequest('WEBHOOK_INVALID', 'Signature or payload rejected');
    return { received: await this.leads.receive(leadgenNotices(parsed.data)) };
  }
}

function single(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
