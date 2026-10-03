import { Controller, Get, Headers, HttpCode, Post, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { z } from 'zod';
import {
  CreateOrderSchema,
  FeeBearerSchema,
  MinorAmountSchema,
  OrderTransitionSchema,
  OrdersQuerySchema,
  SettlementLineSchema,
  UuidSchema,
} from '@resget/shared';
import type { ModeSettlement, OrderDetailDTO, OrderSummaryDTO } from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { RealtimeService, dispatchTopic } from '../realtime/realtime.service';
import { SettlementService } from './settlement.service';
import { OrdersService } from './orders.service';

const PreviewSchema = z
  .object({
    items: z.array(SettlementLineSchema).min(1).max(200),
    deliveryFee: SettlementLineSchema.nullable().optional(),
    discount: z.object({ amountMinor: MinorAmountSchema, fundedBy: FeeBearerSchema }).strict().nullable().optional(),
    courier: z.object({ costMinor: MinorAmountSchema, bearer: FeeBearerSchema }).strict().nullable().optional(),
  })
  .strict();

/** Query strings arrive as strings or repeated keys; normalise `status` to an array before the shared schema. */
const ListQuerySchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object') return raw;
  const query = { ...(raw as Record<string, unknown>) };
  if (typeof query.status === 'string') query.status = query.status.split(',').filter(Boolean);
  return query;
}, OrdersQuerySchema);

const contacts = (tenant: TenantContext): boolean => tenant.permissions.has('customers.contact.view');

@Controller('restaurants/:restaurantId/orders')
@RestaurantScoped()
export class OrdersController {
  constructor(
    private readonly settlement: SettlementService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
  ) {}

  /** SSE for the orders screen: order.updated only, so kitchen roles without dispatch.view can follow live. */
  @Sse('events')
  @RequirePermission('orders.view')
  events(@Tenant() tenant: TenantContext, @Headers('last-event-id') lastEventId?: string): Observable<MessageEvent> {
    return this.realtime.stream(dispatchTopic(tenant.restaurantId), lastEventId, [], (e) => e.type === 'order.updated');
  }

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

  @Get()
  @RequirePermission('orders.view')
  list(
    @Tenant() tenant: TenantContext,
    @ZodQuery(ListQuerySchema) query: z.infer<typeof OrdersQuerySchema>,
  ): Promise<OrderSummaryDTO[]> {
    return this.orders.list(tenant.restaurantId, query, contacts(tenant));
  }

  /** An order taken by staff (phone, counter, table) or entered on behalf of a guest. */
  @Post()
  @RequirePermission('orders.manage')
  create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateOrderSchema) body: z.infer<typeof CreateOrderSchema>,
  ): Promise<OrderDetailDTO> {
    return this.orders.create(tenant.restaurantId, body, user.id, contacts(tenant));
  }

  @Get(':orderId')
  @RequirePermission('orders.view')
  detail(@Tenant() tenant: TenantContext, @ZodParam('orderId', UuidSchema) orderId: string): Promise<OrderDetailDTO> {
    return this.orders.detail(tenant.restaurantId, orderId, contacts(tenant));
  }

  /** Accept (with a preparation time), reject, preparing, ready, cancel; the courier leg comes from the trip. */
  @Post(':orderId/transition')
  @HttpCode(200)
  @RequirePermission('orders.manage')
  transition(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('orderId', UuidSchema) orderId: string,
    @ZodBody(OrderTransitionSchema) body: z.infer<typeof OrderTransitionSchema>,
  ): Promise<OrderDetailDTO> {
    return this.orders.transition(tenant.restaurantId, orderId, body, 'RESTAURANT', user.id, contacts(tenant));
  }
}
