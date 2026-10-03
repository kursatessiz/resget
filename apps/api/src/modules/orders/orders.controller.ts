import { Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { FeeBearerSchema, MinorAmountSchema, SettlementLineSchema } from '@resget/shared';
import type { ModeSettlement } from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { SettlementService } from './settlement.service';

const PreviewSchema = z
  .object({
    items: z.array(SettlementLineSchema).min(1).max(200),
    deliveryFee: SettlementLineSchema.nullable().optional(),
    discount: z.object({ amountMinor: MinorAmountSchema, fundedBy: FeeBearerSchema }).strict().nullable().optional(),
    courier: z.object({ costMinor: MinorAmountSchema, bearer: FeeBearerSchema }).strict().nullable().optional(),
  })
  .strict();

@Controller('restaurants/:restaurantId/orders')
@RestaurantScoped()
export class OrdersController {
  constructor(private readonly settlement: SettlementService) {}

  /** What the restaurant will receive for a basket, before an order exists: the transparency promise of the model. */
  @Post('settlement-preview')
  @HttpCode(200)
  @RequirePermission('orders.view')
  preview(
    @Tenant() tenant: TenantContext,
    @ZodBody(PreviewSchema) body: z.infer<typeof PreviewSchema>,
  ): Promise<ModeSettlement> {
    return this.settlement.forRestaurant(tenant.restaurantId, body);
  }
}
