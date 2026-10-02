import { Controller, Get } from '@nestjs/common';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { MenuService } from './menu.service';

@Controller('restaurants/:restaurantId/menu')
@RestaurantScoped()
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  @RequirePermission('menu.view')
  list(@Tenant() tenant: TenantContext) {
    return this.menu.menuOf(tenant.restaurantId);
  }
}
