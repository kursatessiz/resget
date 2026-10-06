import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { StartTipSchema, TipsReportQuerySchema, TrackingTokenSchema, UuidSchema } from '@resget/shared';
import type {
  CourierTipsSummaryDTO,
  StartTipInput,
  TipDTO,
  TipStartedDTO,
  TipsReportDTO,
  TipsReportQuery,
} from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { forbidden } from '../../common/api-error';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { TipsService } from './tips.service';

/** The restaurant's tip report and the hand-over retry (docs/BAHSIS.md). */
@Controller('restaurants/:restaurantId/tips')
@RestaurantScoped()
export class TipsController {
  constructor(private readonly tips: TipsService) {}

  @Get()
  @RequirePermission('courier.manage')
  @RequireFeature('courier_tips')
  report(
    @Tenant() tenant: TenantContext,
    @ZodQuery(TipsReportQuerySchema) query: TipsReportQuery,
  ): Promise<TipsReportDTO> {
    return this.tips.report(tenant.restaurantId, query.days);
  }

  /** The signed-in courier's own tips (docs/BAHSIS.md, "Rapor"); a courier never sees another's. */
  @Get('me')
  @RequirePermission('courier.deliver')
  @RequireFeature('courier_tips')
  mine(
    @Tenant() tenant: TenantContext,
    @ZodQuery(TipsReportQuerySchema) query: TipsReportQuery,
  ): Promise<CourierTipsSummaryDTO> {
    if (!tenant.membershipId) throw forbidden('COURIER_NOT_ASSIGNED', 'Super admins have no courier identity');
    return this.tips.mine(tenant.restaurantId, tenant.membershipId, query.days);
  }

  @Post(':tipId/pass-through')
  @HttpCode(200)
  @RequirePermission('courier.manage')
  @RequireFeature('courier_tips')
  retry(@Tenant() tenant: TenantContext, @ZodParam('tipId', UuidSchema) tipId: string): Promise<TipDTO> {
    return this.tips.retryPassThrough(tenant.restaurantId, tipId);
  }
}

/** The customer's tip from the tracking page, by tracking token; rate limited like the other anonymous writes. */
@Controller('public')
export class PublicTipsController {
  constructor(private readonly tips: TipsService) {}

  @Post('orders/:token/tip')
  @HttpCode(200)
  @UseGuards(PublicRateLimitGuard)
  @RateLimit({ bucket: 'funnel', limit: 20, windowSeconds: 600 })
  start(
    @ZodParam('token', TrackingTokenSchema) token: string,
    @ZodBody(StartTipSchema) body: StartTipInput,
    @Req() req: Request,
  ): Promise<TipStartedDTO> {
    return this.tips.start(token, body, req.ip);
  }
}
