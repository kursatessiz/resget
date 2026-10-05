import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CollectTabPaymentSchema, TabTokenSchema, UuidSchema } from '@resget/shared';
import type { CollectTabPaymentInput, TabBillDTO, TabSummaryDTO } from '@resget/shared';
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
}
