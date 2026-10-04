import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { CourierQuoteRequestSchema, MinorAmountSchema, SelectCourierProviderSchema } from '@resget/shared';
import type { CourierOverviewDTO } from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { CourierOverviewQueries, CourierService } from './courier.service';
import type { QuoteWithCustomerFee } from './courier.service';

const QuoteBodySchema = CourierQuoteRequestSchema.omit({ restaurantId: true })
  .extend({ basketMinor: MinorAmountSchema })
  .strict();

@Controller('restaurants/:restaurantId/courier')
@RestaurantScoped()
export class CourierController {
  constructor(
    private readonly courier: CourierService,
    private readonly overviewQueries: CourierOverviewQueries,
  ) {}

  /** The courier screen: own couriers, the network, recent requests and today's counts. */
  @Get('overview')
  @RequirePermission('courier.manage')
  overview(@Tenant() tenant: TenantContext): Promise<CourierOverviewDTO> {
    return this.overviewQueries.overview(tenant.restaurantId);
  }

  @Put('provider')
  @RequirePermission('courier.manage')
  @RequireFeature('courier_network')
  selectProvider(
    @Tenant() tenant: TenantContext,
    @ZodBody(SelectCourierProviderSchema) body: z.infer<typeof SelectCourierProviderSchema>,
  ): Promise<CourierOverviewDTO> {
    return this.overviewQueries.selectProvider(tenant.restaurantId, body.courierProviderId);
  }

  @Post('quote')
  @HttpCode(200)
  @RequirePermission('courier.manage')
  @RequireFeature('courier_network')
  quote(
    @Tenant() tenant: TenantContext,
    @ZodBody(QuoteBodySchema) body: z.infer<typeof QuoteBodySchema>,
  ): Promise<QuoteWithCustomerFee> {
    const { basketMinor, ...request } = body;
    return this.courier.quoteFor(tenant.restaurantId, request, basketMinor);
  }
}
