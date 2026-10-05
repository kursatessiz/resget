import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { KitchenQuerySchema, MarkItemPreparedSchema, UuidSchema } from '@resget/shared';
import type { KitchenBoardDTO, KitchenQuery, MarkItemPreparedInput } from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { KitchenService } from './kitchen.service';

/** The kitchen display (docs/MUTFAK_EKRANI.md). */
@Controller('restaurants/:restaurantId/kitchen')
@RestaurantScoped()
@RequireFeature('kitchen_display')
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get()
  @RequirePermission('orders.view')
  board(@Tenant() tenant: TenantContext, @ZodQuery(KitchenQuerySchema) query: KitchenQuery): Promise<KitchenBoardDTO> {
    return this.kitchen.board(tenant.restaurantId, query.station);
  }

  @Post('items/:itemId/prepared')
  @HttpCode(204)
  @RequirePermission('orders.manage')
  async mark(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('itemId', UuidSchema) itemId: string,
    @ZodBody(MarkItemPreparedSchema) body: MarkItemPreparedInput,
  ): Promise<void> {
    await this.kitchen.markItem(tenant.restaurantId, itemId, body.prepared, user.id);
  }
}
