import { Controller, Get, Put } from '@nestjs/common';
import { UpdateDeliveryZoneSchema } from '@resget/shared';
import type { DeliveryZoneDTO, UpdateDeliveryZoneInput } from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { DeliveryZoneService } from './delivery-zone.service';

/** The restaurant's delivery zone (docs/VITRIN.md, "Teslimat bölgesi"). */
@Controller('restaurants/:restaurantId/delivery-zone')
@RestaurantScoped()
@RequireFeature('delivery_zones')
export class DeliveryZoneController {
  constructor(private readonly zones: DeliveryZoneService) {}

  @Get()
  @RequirePermission('restaurant.settings.view')
  get(@Tenant() tenant: TenantContext): Promise<DeliveryZoneDTO> {
    return this.zones.get(tenant);
  }

  @Put()
  @RequirePermission('restaurant.settings.manage')
  set(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateDeliveryZoneSchema) body: UpdateDeliveryZoneInput,
  ): Promise<DeliveryZoneDTO> {
    return this.zones.set(tenant, user.id, body);
  }
}
