import { Controller, Get } from '@nestjs/common';
import { z } from 'zod';
import { CHURN_WATCH_RISKS } from '@resget/shared';
import type { ChurnCustomerDTO, ChurnOverviewDTO, RestaurantHealthPageDTO } from '@resget/shared';
import { ZodQuery } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { ChurnService } from './churn.service';
import { RestaurantHealthService } from './restaurant-health.service';

const CustomersQuerySchema = z.object({ risk: z.enum(CHURN_WATCH_RISKS).default('AT_RISK') }).strict();

/** Customer churn classes (docs/KAYIP_RISKI.md); PRO analytics. */
@Controller('restaurants/:restaurantId/churn')
@RestaurantScoped()
@RequireFeature('churn_signals')
@RequirePlanFeature('analytics')
export class ChurnController {
  constructor(private readonly churn: ChurnService) {}

  @Get('overview')
  @RequirePermission('customers.view')
  overview(@Tenant() tenant: TenantContext): Promise<ChurnOverviewDTO> {
    return this.churn.overview(tenant.restaurantId, new Date());
  }

  @Get('customers')
  @RequirePermission('customers.view')
  customers(
    @Tenant() tenant: TenantContext,
    @ZodQuery(CustomersQuerySchema) query: z.infer<typeof CustomersQuerySchema>,
  ): Promise<ChurnCustomerDTO[]> {
    return this.churn.customers(
      tenant.restaurantId,
      query.risk,
      tenant.permissions.has('customers.contact.view'),
      new Date(),
    );
  }
}

/** Restaurant health signals for the platform owner. */
@Controller('admin/restaurant-health')
@SuperAdminOnly()
export class AdminRestaurantHealthController {
  constructor(private readonly health: RestaurantHealthService) {}

  @Get()
  list(): Promise<RestaurantHealthPageDTO> {
    return this.health.list(new Date());
  }
}
