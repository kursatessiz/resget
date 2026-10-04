import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  AD_CONNECTION_PLATFORMS,
  AdReportQuerySchema,
  ConnectAdSchema,
  UpdateAdConnectionSchema,
} from '@resget/shared';
import type {
  AdConnectionDTO,
  AdConnectionPlatform,
  AdPerformanceDTO,
  ConnectAdInput,
  UpdateAdConnectionInput,
} from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { AdsService } from './ads.service';

const PlatformParam = z.enum(AD_CONNECTION_PLATFORMS);

/** Ad accounts, conversion delivery and spend (docs/REKLAM.md); PRO analytics. */
@Controller('restaurants/:restaurantId/ads')
@RestaurantScoped()
@RequireFeature('ad_integrations')
@RequirePlanFeature('analytics')
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Get('connections')
  @RequirePermission('integrations.manage')
  list(@Tenant() tenant: TenantContext): Promise<AdConnectionDTO[]> {
    return this.ads.list(tenant.restaurantId);
  }

  @Put('connections/:platform')
  @RequirePermission('integrations.manage')
  connect(
    @Tenant() tenant: TenantContext,
    @ZodParam('platform', PlatformParam) platform: AdConnectionPlatform,
    @ZodBody(ConnectAdSchema) body: ConnectAdInput,
  ): Promise<AdConnectionDTO> {
    return this.ads.connect(tenant.restaurantId, platform, body);
  }

  @Patch('connections/:platform')
  @RequirePermission('integrations.manage')
  update(
    @Tenant() tenant: TenantContext,
    @ZodParam('platform', PlatformParam) platform: AdConnectionPlatform,
    @ZodBody(UpdateAdConnectionSchema) body: UpdateAdConnectionInput,
  ): Promise<AdConnectionDTO> {
    return this.ads.update(tenant.restaurantId, platform, body);
  }

  @Delete('connections/:platform')
  @HttpCode(204)
  @RequirePermission('integrations.manage')
  async remove(
    @Tenant() tenant: TenantContext,
    @ZodParam('platform', PlatformParam) platform: AdConnectionPlatform,
  ): Promise<void> {
    await this.ads.remove(tenant.restaurantId, platform);
  }

  /** Pulls spend now instead of waiting for the next scheduled sync. */
  @Post('spend/sync')
  @HttpCode(200)
  @RequirePermission('integrations.manage')
  async sync(@Tenant() tenant: TenantContext): Promise<{ rows: number }> {
    return { rows: await this.ads.syncSpend(new Date(), tenant.restaurantId) };
  }

  @Get('performance')
  @RequirePermission('reports.view')
  performance(
    @Tenant() tenant: TenantContext,
    @ZodQuery(AdReportQuerySchema) query: { days: number },
  ): Promise<AdPerformanceDTO> {
    return this.ads.performance(tenant.restaurantId, query.days);
  }
}
