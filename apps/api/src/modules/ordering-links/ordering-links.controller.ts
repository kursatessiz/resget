import { Controller, Get } from '@nestjs/common';
import type { OrderingLinksDTO } from '@resget/shared';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { OrderingLinksService } from './ordering-links.service';

/** The restaurant's ordering links per outside channel (docs/SIPARIS_BAGLANTILARI.md). */
@Controller('restaurants/:restaurantId/ordering-links')
@RestaurantScoped()
@RequireFeature('ordering_links')
export class OrderingLinksController {
  constructor(private readonly links: OrderingLinksService) {}

  @Get()
  @RequirePermission('reports.view')
  get(@Tenant() tenant: TenantContext): Promise<OrderingLinksDTO> {
    return this.links.links(tenant.restaurantId);
  }
}
