import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { CreateCouponSchema, UpdateCouponSchema, UuidSchema } from '@resget/shared';
import type { CouponDTO, CreateCouponInput, UpdateCouponInput } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { CouponsService } from './coupons.service';

/** The restaurant's coupons (docs/KUPONLAR.md); reading is open so a lapsed plan still sees its codes. */
@Controller('restaurants/:restaurantId/coupons')
@RestaurantScoped()
@RequireFeature('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @RequirePermission('campaigns.view')
  list(@Tenant() tenant: TenantContext): Promise<CouponDTO[]> {
    return this.coupons.list(tenant.restaurantId);
  }

  @Post()
  @RequirePermission('campaigns.manage')
  @RequirePlanFeature('coupons')
  create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateCouponSchema) body: CreateCouponInput,
  ): Promise<CouponDTO> {
    return this.coupons.create(tenant.restaurantId, user.id, body);
  }

  @Patch(':couponId')
  @RequirePermission('campaigns.manage')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('couponId', UuidSchema) couponId: string,
    @ZodBody(UpdateCouponSchema) body: UpdateCouponInput,
  ): Promise<CouponDTO> {
    return this.coupons.setActive(tenant.restaurantId, user.id, couponId, body.isActive);
  }

  @Delete(':couponId')
  @HttpCode(204)
  @RequirePermission('campaigns.manage')
  async remove(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('couponId', UuidSchema) couponId: string,
  ): Promise<void> {
    await this.coupons.remove(tenant.restaurantId, user.id, couponId);
  }
}
