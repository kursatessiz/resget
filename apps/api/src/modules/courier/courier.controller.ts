import { Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { CourierQuoteRequestSchema, MinorAmountSchema } from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { CourierService } from './courier.service';
import type { QuoteWithCustomerFee } from './courier.service';

const QuoteBodySchema = CourierQuoteRequestSchema.omit({ restaurantId: true })
  .extend({ basketMinor: MinorAmountSchema })
  .strict();

@Controller('restaurants/:restaurantId/courier')
@RestaurantScoped()
export class CourierController {
  constructor(private readonly courier: CourierService) {}

  @Post('quote')
  @HttpCode(200)
  @RequirePermission('courier.manage')
  quote(
    @Tenant() tenant: TenantContext,
    @ZodBody(QuoteBodySchema) body: z.infer<typeof QuoteBodySchema>,
  ): Promise<QuoteWithCustomerFee> {
    const { basketMinor, ...request } = body;
    return this.courier.quoteFor(tenant.restaurantId, request, basketMinor);
  }
}
