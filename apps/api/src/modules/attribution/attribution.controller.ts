import { Body, Controller, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  AttributionQuerySchema,
  PlatformLeadSchema,
  SlugSchema,
  TouchpointInputSchema,
  VISITOR_HEADER,
} from '@resget/shared';
import type {
  AttributionQuery,
  AttributionReportDTO,
  PlatformLeadInput,
  PlatformSiteDTO,
  TouchpointInput,
} from '@resget/shared';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { AttributionService } from './attribution.service';

/** The attribution report of a tenant (docs/ATIF.md); PRO analytics, like the other reports. */
@Controller('restaurants/:restaurantId/attribution')
@RestaurantScoped()
@RequireFeature('attribution')
export class AttributionController {
  constructor(private readonly attribution: AttributionService) {}

  @Get()
  @RequirePermission('reports.view')
  @RequirePlanFeature('analytics')
  report(
    @Tenant() tenant: TenantContext,
    @ZodQuery(AttributionQuerySchema) query: AttributionQuery,
  ): Promise<AttributionReportDTO> {
    return this.attribution.report(tenant.restaurantId, tenant.isPlatform, query);
  }
}

/**
 * Unauthenticated tracking and the platform lead form. The touchpoint call
 * answers 204 whatever happened, so it reveals nothing about tenants,
 * consent or bots; both writes are rate limited per client.
 */
@Controller('public')
@UseGuards(PublicRateLimitGuard)
export class TrackingController {
  constructor(private readonly attribution: AttributionService) {}

  @Post('track/:target/touchpoint')
  @HttpCode(204)
  @RateLimit({ bucket: 'track', limit: 60, windowSeconds: 60 })
  async touchpoint(
    @Param('target') target: string,
    @Body() raw: unknown,
    @Headers('user-agent') userAgent?: string,
    @Headers('cf-ipcountry') cfCountry?: string,
    @Headers('x-country-code') edgeCountry?: string,
  ): Promise<void> {
    // A malformed beacon is dropped quietly instead of answering 400: the browser has nothing to fix.
    const parsed = TouchpointInputSchema.safeParse(raw);
    if (!parsed.success || (target !== 'platform' && !SlugSchema.safeParse(target).success)) return;
    const input: TouchpointInput = parsed.data;
    await this.attribution.recordTouchpoint(target, input, {
      userAgent: userAgent ?? null,
      edgeCountry: cfCountry ?? edgeCountry ?? null,
    });
  }

  @Get('platform/site')
  site(): Promise<PlatformSiteDTO> {
    return this.attribution.platformSite();
  }

  @Post('platform/leads')
  @HttpCode(204)
  @RateLimit({ bucket: 'lead', limit: 5, windowSeconds: 600 })
  async lead(
    @ZodBody(PlatformLeadSchema) body: PlatformLeadInput,
    @Headers(VISITOR_HEADER) visitorId?: string,
  ): Promise<void> {
    await this.attribution.platformLead(body, visitorId ?? null);
  }
}
