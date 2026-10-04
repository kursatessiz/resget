import { Controller, Get, Put } from '@nestjs/common';
import { UpdateAvailabilitySchema, UpdateOpeningHoursSchema } from '@resget/shared';
import type {
  BranchHoursDTO,
  OrderAvailabilityDTO,
  UpdateAvailabilityInput,
  UpdateOpeningHoursInput,
} from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { AvailabilityService } from './availability.service';

/** Pause, busy mode and opening hours of the restaurant (docs/SIPARIS_VE_SEVK.md, "Sipariş alma durumu"). */
@Controller('restaurants/:restaurantId')
@RestaurantScoped()
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  /** Readable while the module is off too: the panel then shows nothing to change. */
  @Get('availability')
  @RequirePermission('orders.view')
  get(@Tenant() tenant: TenantContext): Promise<OrderAvailabilityDTO> {
    return this.availability.forTenant(tenant);
  }

  @Put('availability')
  @RequirePermission('orders.manage')
  @RequireFeature('order_availability')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateAvailabilitySchema) body: UpdateAvailabilityInput,
  ): Promise<OrderAvailabilityDTO> {
    return this.availability.update(tenant, user.id, body);
  }

  /** Opening hours also feed the marketplace "open now" label, so they are editable whatever the switch says. */
  @Get('opening-hours')
  @RequirePermission('restaurant.settings.view')
  hours(@Tenant() tenant: TenantContext): Promise<BranchHoursDTO[]> {
    return this.availability.hours(tenant);
  }

  @Put('opening-hours')
  @RequirePermission('restaurant.settings.manage')
  setHours(
    @Tenant() tenant: TenantContext,
    @ZodBody(UpdateOpeningHoursSchema) body: UpdateOpeningHoursInput,
  ): Promise<BranchHoursDTO[]> {
    return this.availability.setHours(tenant, body);
  }
}
