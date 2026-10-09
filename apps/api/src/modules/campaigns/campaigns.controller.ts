import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  CampaignsQuerySchema,
  CountAudienceSchema,
  CreateCampaignSchema,
  RejectCampaignSchema,
  SaveSegmentSchema,
  SendCampaignSchema,
  UpdateCampaignSchema,
  UuidSchema,
  TrackingTokenSchema,
} from '@resget/shared';
import type {
  AudienceCountDTO,
  CampaignAudienceDTO,
  CampaignDTO,
  CampaignResultsDTO,
  CampaignDetailDTO,
  CampaignPageDTO,
  CampaignPreviewDTO,
  RejectCampaignInput,
  SavedSegmentDTO,
} from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { CampaignsService } from './campaigns.service';
import { EmailTrackingService } from './email-tracking.service';

/** PRO campaigns of a restaurant (docs/KAMPANYALAR.md); every route needs the `campaigns` plan feature. */
@Controller('restaurants/:restaurantId/campaigns')
@RestaurantScoped()
@RequireFeature('campaigns')
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

  /** How many opted-in customers an ad-hoc filter matches right now; the screen shows it before saving. */
  @Post('audience/count')
  @HttpCode(200)
  @RequirePermission('campaigns.view')
  async countAudience(
    @Tenant() tenant: TenantContext,
    @ZodBody(CountAudienceSchema) body: z.infer<typeof CountAudienceSchema>,
  ): Promise<AudienceCountDTO> {
    return { audienceCount: await this.campaigns.countAudience(tenant.restaurantId, body.segment) };
  }

  // Saved segments come before the `:campaignId` routes so the literal path wins.
  @Get('segments')
  @RequirePermission('campaigns.view')
  segments(@Tenant() tenant: TenantContext): Promise<SavedSegmentDTO[]> {
    return this.campaigns.segments(tenant.restaurantId);
  }

  @Post('segments')
  @RequirePermission('campaigns.manage')
  saveSegment(
    @Tenant() tenant: TenantContext,
    @ZodBody(SaveSegmentSchema) body: z.infer<typeof SaveSegmentSchema>,
  ): Promise<SavedSegmentDTO> {
    return this.campaigns.saveSegment(tenant.restaurantId, body);
  }

  @Put('segments/:segmentId')
  @RequirePermission('campaigns.manage')
  updateSegment(
    @Tenant() tenant: TenantContext,
    @ZodParam('segmentId', UuidSchema) segmentId: string,
    @ZodBody(SaveSegmentSchema) body: z.infer<typeof SaveSegmentSchema>,
  ): Promise<SavedSegmentDTO> {
    return this.campaigns.saveSegment(tenant.restaurantId, body, segmentId);
  }

  @Delete('segments/:segmentId')
  @HttpCode(204)
  @RequirePermission('campaigns.manage')
  deleteSegment(@Tenant() tenant: TenantContext, @ZodParam('segmentId', UuidSchema) segmentId: string): Promise<void> {
    return this.campaigns.deleteSegment(tenant.restaurantId, segmentId);
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

  @Get(':campaignId/results')
  @RequirePermission('campaigns.view')
  results(
    @Tenant() tenant: TenantContext,
    @ZodParam('campaignId', UuidSchema) id: string,
  ): Promise<CampaignResultsDTO> {
    return this.campaigns.results(tenant.restaurantId, id);
  }

  @Patch(':campaignId')
  @RequirePermission('campaigns.manage')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('campaignId', UuidSchema) id: string,
    @ZodBody(UpdateCampaignSchema) body: z.infer<typeof UpdateCampaignSchema>,
  ): Promise<CampaignDTO> {
    return this.campaigns.update(tenant.restaurantId, id, user.id, body);
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
    @CurrentUser() user: AuthUser,
    @ZodParam('campaignId', UuidSchema) id: string,
    @ZodBody(SendCampaignSchema) body: z.infer<typeof SendCampaignSchema>,
  ): Promise<CampaignDTO> {
    return this.campaigns.send(tenant.restaurantId, id, user.id, body);
  }

  @Post(':campaignId/cancel')
  @HttpCode(200)
  @RequirePermission('campaigns.manage')
  cancel(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('campaignId', UuidSchema) id: string,
  ): Promise<CampaignDTO> {
    return this.campaigns.cancel(tenant.restaurantId, id, user.id);
  }

  /** Send approvals (docs/ONAYLAR.md): the marketing_approvals module must be on. */
  @Post(':campaignId/approval/request')
  @HttpCode(200)
  @RequirePermission('campaigns.manage')
  requestApproval(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('campaignId', UuidSchema) id: string,
  ): Promise<CampaignDTO> {
    return this.campaigns.requestApproval(tenant.restaurantId, id, user.id);
  }

  @Post(':campaignId/approval/approve')
  @HttpCode(200)
  @RequirePermission('campaigns.approve')
  approve(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('campaignId', UuidSchema) id: string,
  ): Promise<CampaignDTO> {
    return this.campaigns.decideApproval(tenant.restaurantId, id, user.id, { approve: true });
  }

  @Post(':campaignId/approval/reject')
  @HttpCode(200)
  @RequirePermission('campaigns.approve')
  reject(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('campaignId', UuidSchema) id: string,
    @ZodBody(RejectCampaignSchema) body: RejectCampaignInput,
  ): Promise<CampaignDTO> {
    return this.campaigns.decideApproval(tenant.restaurantId, id, user.id, { approve: false, note: body.note });
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

/** A 1x1 transparent GIF. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Campaign email opens and clicks (docs/EPOSTA.md): public, rate limited, and the same answer for any token,
 * so it tells nothing about which tokens exist.
 */
@Controller('public/email')
@UseGuards(PublicRateLimitGuard)
export class EmailTrackingController {
  constructor(private readonly tracking: EmailTrackingService) {}

  @Get('o/:token')
  @RateLimit({ bucket: 'email-tracking', limit: 600, windowSeconds: 600 })
  async open(@Param('token') token: string, @Res() res: Response): Promise<void> {
    if (TrackingTokenSchema.safeParse(token).success) await this.tracking.recordOpen(token);
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0' }).status(200).send(PIXEL);
  }

  @Get('c/:token/:index')
  @RateLimit({ bucket: 'email-tracking', limit: 600, windowSeconds: 600 })
  async click(@Param('token') token: string, @Param('index') index: string, @Res() res: Response): Promise<void> {
    const at = Number(index);
    const valid = TrackingTokenSchema.safeParse(token).success && Number.isInteger(at) && at >= 0 && at < 100;
    const destination = valid ? await this.tracking.resolveClick(token, at) : this.tracking.home();
    res.set('Cache-Control', 'no-store').redirect(302, destination);
  }
}
