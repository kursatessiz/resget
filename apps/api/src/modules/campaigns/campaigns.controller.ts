import { Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import {
  CampaignsQuerySchema,
  CreateCampaignSchema,
  SendCampaignSchema,
  UpdateCampaignSchema,
  UuidSchema,
} from '@resget/shared';
import type {
  CampaignAudienceDTO,
  CampaignDTO,
  CampaignDetailDTO,
  CampaignPageDTO,
  CampaignPreviewDTO,
} from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import {
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { CampaignsService } from './campaigns.service';

/** PRO campaigns of a restaurant (docs/KAMPANYALAR.md); every route needs the `campaigns` plan feature. */
@Controller('restaurants/:restaurantId/campaigns')
@RestaurantScoped()
@RequirePlanFeature('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermission('campaigns.view')
  list(
    @Tenant() tenant: TenantContext,
    @ZodQuery(CampaignsQuerySchema) query: z.infer<typeof CampaignsQuerySchema>,
  ): Promise<CampaignPageDTO> {
    return this.campaigns.list(tenant.restaurantId, query.page, query.pageSize, query.status);
  }

  @Get('audience')
  @RequirePermission('campaigns.view')
  audience(@Tenant() tenant: TenantContext): Promise<CampaignAudienceDTO> {
    return this.campaigns.audience(tenant.restaurantId);
  }

  @Post()
  @RequirePermission('campaigns.manage')
  create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateCampaignSchema) body: z.infer<typeof CreateCampaignSchema>,
  ): Promise<CampaignDTO> {
    return this.campaigns.create(tenant.restaurantId, user.id, body);
  }

  @Get(':campaignId')
  @RequirePermission('campaigns.view')
  detail(@Tenant() tenant: TenantContext, @ZodParam('campaignId', UuidSchema) id: string): Promise<CampaignDetailDTO> {
    return this.campaigns.detail(tenant.restaurantId, id);
  }

  @Patch(':campaignId')
  @RequirePermission('campaigns.manage')
  update(
    @Tenant() tenant: TenantContext,
    @ZodParam('campaignId', UuidSchema) id: string,
    @ZodBody(UpdateCampaignSchema) body: z.infer<typeof UpdateCampaignSchema>,
  ): Promise<CampaignDTO> {
    return this.campaigns.update(tenant.restaurantId, id, body);
  }

  @Post(':campaignId/preview')
  @HttpCode(200)
  @RequirePermission('campaigns.view')
  preview(
    @Tenant() tenant: TenantContext,
    @ZodParam('campaignId', UuidSchema) id: string,
  ): Promise<CampaignPreviewDTO> {
    return this.campaigns.preview(tenant.restaurantId, id);
  }

  @Post(':campaignId/send')
  @HttpCode(200)
  @RequirePermission('campaigns.manage')
  send(
    @Tenant() tenant: TenantContext,
    @ZodParam('campaignId', UuidSchema) id: string,
    @ZodBody(SendCampaignSchema) body: z.infer<typeof SendCampaignSchema>,
  ): Promise<CampaignDTO> {
    return this.campaigns.send(tenant.restaurantId, id, body);
  }

  @Post(':campaignId/cancel')
  @HttpCode(200)
  @RequirePermission('campaigns.manage')
  cancel(@Tenant() tenant: TenantContext, @ZodParam('campaignId', UuidSchema) id: string): Promise<CampaignDTO> {
    return this.campaigns.cancel(tenant.restaurantId, id);
  }
}

/** The one-click opt-out behind every campaign message; public, rate limited, idempotent. */
@Controller('public/marketing')
@UseGuards(PublicRateLimitGuard)
export class MarketingOptOutController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post('opt-out/:token')
  @HttpCode(200)
  @RateLimit({ bucket: 'funnel', limit: 60, windowSeconds: 600 })
  optOut(@ZodParam('token', UuidSchema) token: string): Promise<{ restaurantName: string }> {
    return this.campaigns.optOut(token);
  }
}
