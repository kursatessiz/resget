import { Controller, Get, Patch } from '@nestjs/common';
import type { z } from 'zod';
import { UpdateRestaurantSettingsSchema } from '@resget/shared';
import type { RestaurantSettingsDTO } from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { RestaurantsService } from './restaurants.service';

@Controller('restaurants/:restaurantId')
@RestaurantScoped()
export class RestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Get()
  @RequirePermission('restaurant.settings.view')
  get(@Tenant() tenant: TenantContext): Promise<RestaurantSettingsDTO> {
    return this.restaurants.settings(tenant);
  }

  @Patch()
  @RequirePermission('restaurant.settings.manage')
  update(
    @Tenant() tenant: TenantContext,
    @ZodBody(UpdateRestaurantSettingsSchema) body: z.infer<typeof UpdateRestaurantSettingsSchema>,
  ): Promise<RestaurantSettingsDTO> {
    return this.restaurants.update(tenant, body);
  }
}
