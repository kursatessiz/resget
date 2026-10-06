import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CollectTabPaymentSchema, PayTabShareSchema, TabTokenSchema, UuidSchema } from '@resget/shared';
import type {
  CollectTabPaymentInput,
  PayTabShareInput,
  TabBillDTO,
  TabPaymentStartedDTO,
  TabSummaryDTO,
} from '@resget/shared';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { TabsService } from './tabs.service';

/** Open tabs of the restaurant's tables (docs/ACIK_HESAP.md). */
@Controller('restaurants/:restaurantId/tabs')
@RestaurantScoped()
@RequireFeature('table_tabs')
export class TabsController {
  constructor(private readonly tabs: TabsService) {}

  @Get()
  @RequirePermission('orders.view')
  list(@Tenant() tenant: TenantContext): Promise<TabSummaryDTO[]> {
    return this.tabs.listOpen(tenant.restaurantId);
  }

  @Get(':tabId')
  @RequirePermission('orders.view')
  bill(@Tenant() tenant: TenantContext, @ZodParam('tabId', UuidSchema) tabId: string): Promise<TabBillDTO> {
    return this.tabs.bill(tenant.restaurantId, tabId);
  }

  @Post(':tabId/collect')
  @HttpCode(200)
  @RequirePermission('orders.manage')
  collect(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tabId', UuidSchema) tabId: string,
    @ZodBody(CollectTabPaymentSchema) body: CollectTabPaymentInput,
  ): Promise<TabBillDTO> {
    return this.tabs.collect(tenant.restaurantId, tabId, body, user.id);
  }

  @Post(':tabId/close')
  @HttpCode(200)
  @RequirePermission('orders.manage')
  close(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tabId', UuidSchema) tabId: string,
  ): Promise<TabBillDTO> {
    return this.tabs.close(tenant.restaurantId, tabId, user.id);
  }
}

/** The bill the table sees through its link; read only and without personal data. */
@Controller('public/tabs')
export class PublicTabsController {
  constructor(private readonly tabs: TabsService) {}

  @Get(':token')
  bill(@ZodParam('token', TabTokenSchema) token: string): Promise<TabBillDTO> {
    return this.tabs.publicBill(token);
  }

  /** A guest pays a share by card on the restaurant's own POS; rate limited like the other anonymous writes. */
  @Post(':token/pay')
  @HttpCode(200)
  @UseGuards(PublicRateLimitGuard)
  @RateLimit({ bucket: 'funnel', limit: 20, windowSeconds: 600 })
  pay(
    @ZodParam('token', TabTokenSchema) token: string,
    @ZodBody(PayTabShareSchema) body: PayTabShareInput,
    @Req() req: Request,
  ): Promise<TabPaymentStartedDTO> {
    return this.tabs.startOnlinePayment(token, body, req.ip);
  }
}
