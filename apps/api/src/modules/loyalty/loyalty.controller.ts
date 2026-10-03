import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import { AdjustLoyaltySchema, UpdateLoyaltyProgramSchema, UuidSchema } from '@resget/shared';
import type { CustomerLoyaltyDTO, LoyaltyOverviewDTO, LoyaltyProgramDTO } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import {
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { LoyaltyService } from './loyalty.service';

/** The restaurant's loyalty program (docs/SADAKAT.md); reading is open so BASIC sees the rule, writing is PRO. */
@Controller('restaurants/:restaurantId/loyalty')
@RestaurantScoped()
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  @RequirePermission('loyalty.view')
  overview(@Tenant() tenant: TenantContext): Promise<LoyaltyOverviewDTO> {
    return this.loyalty.overview(tenant.restaurantId);
  }

  @Put()
  @RequirePermission('loyalty.manage')
  @RequirePlanFeature('loyalty')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateLoyaltyProgramSchema) body: z.infer<typeof UpdateLoyaltyProgramSchema>,
  ): Promise<LoyaltyProgramDTO> {
    return this.loyalty.updateProgram(tenant.restaurantId, body, user.id);
  }

  @Get('customers/:customerId')
  @RequirePermission('loyalty.view', 'customers.view')
  history(
    @Tenant() tenant: TenantContext,
    @ZodParam('customerId', UuidSchema) customerId: string,
  ): Promise<CustomerLoyaltyDTO> {
    return this.loyalty.customerHistory(tenant.restaurantId, customerId);
  }

  @Post('customers/:customerId/adjust')
  @HttpCode(200)
  @RequirePermission('loyalty.manage')
  @RequirePlanFeature('loyalty')
  adjust(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('customerId', UuidSchema) customerId: string,
    @ZodBody(AdjustLoyaltySchema) body: z.infer<typeof AdjustLoyaltySchema>,
  ): Promise<CustomerLoyaltyDTO> {
    return this.loyalty.adjust(tenant.restaurantId, customerId, body, user.id);
  }
}
