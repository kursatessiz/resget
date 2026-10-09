import { Controller, Delete, Get, Headers, HttpCode, Post, Put, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { z } from 'zod';
import {
  AddStopSchema,
  AssignCourierSchema,
  CancelTripSchema,
  CreateTripSchema,
  ReorderStopsSchema,
  DeliverStopSchema,
  StopFailureSchema,
  TripsQuerySchema,
  UuidSchema,
} from '@resget/shared';
import type { DeliverStopInput, DeliveryTripDTO, DispatchBoardDTO } from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { RealtimeService, dispatchTopic } from '../realtime/realtime.service';
import { OrdersService } from '../orders/orders.service';
import { DispatchService } from './dispatch.service';

const TripsListSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object') return raw;
  const query = { ...(raw as Record<string, unknown>) };
  if (typeof query.status === 'string') query.status = query.status.split(',').filter(Boolean);
  return query;
}, TripsQuerySchema);

const contacts = (tenant: TenantContext): boolean => tenant.permissions.has('customers.contact.view');
const staff = (user: AuthUser) => ({ userId: user.id, role: 'RESTAURANT' as const });

/** The restaurant's dispatch board: ready orders, trips, couriers, and the live stream behind it. */
@Controller('restaurants/:restaurantId/dispatch')
@RestaurantScoped()
@RequireFeature('own_courier_dispatch')
export class DispatchController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('board')
  @RequirePermission('dispatch.view')
  board(@Tenant() tenant: TenantContext): Promise<DispatchBoardDTO> {
    return this.dispatch.board(tenant.restaurantId, contacts(tenant));
  }

  /** SSE: order.updated, trip.updated and courier.location for this restaurant. */
  @Sse('events')
  @RequirePermission('dispatch.view')
  events(@Tenant() tenant: TenantContext, @Headers('last-event-id') lastEventId?: string): Observable<MessageEvent> {
    return this.realtime.stream(
      dispatchTopic(tenant.restaurantId),
      lastEventId,
      [],
      undefined,
      OrdersService.viewForContacts(contacts(tenant)),
    );
  }

  @Get('trips')
  @RequirePermission('dispatch.view')
  trips(
    @Tenant() tenant: TenantContext,
    @ZodQuery(TripsListSchema) query: z.infer<typeof TripsQuerySchema>,
  ): Promise<DeliveryTripDTO[]> {
    return this.dispatch.listTrips(tenant.restaurantId, { status: query.status, limit: query.limit });
  }

  @Post('trips')
  @RequirePermission('dispatch.manage')
  create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateTripSchema) body: z.infer<typeof CreateTripSchema>,
  ): Promise<DeliveryTripDTO> {
    return this.dispatch.createTrip(tenant.restaurantId, body, staff(user));
  }

  @Get('trips/:tripId')
  @RequirePermission('dispatch.view')
  trip(@Tenant() tenant: TenantContext, @ZodParam('tripId', UuidSchema) tripId: string): Promise<DeliveryTripDTO> {
    return this.dispatch.getTrip(tenant.restaurantId, tripId);
  }

  @Put('trips/:tripId/courier')
  @RequirePermission('dispatch.manage')
  assign(
    @Tenant() tenant: TenantContext,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodBody(AssignCourierSchema) body: z.infer<typeof AssignCourierSchema>,
  ): Promise<DeliveryTripDTO> {
    return this.dispatch.assignCourier(tenant.restaurantId, tripId, body.courierMembershipId);
  }

  @Post('trips/:tripId/stops')
  @RequirePermission('dispatch.manage')
  addStop(
    @Tenant() tenant: TenantContext,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodBody(AddStopSchema) body: z.infer<typeof AddStopSchema>,
  ): Promise<DeliveryTripDTO> {
    return this.dispatch.addStop(tenant.restaurantId, tripId, body.orderId);
  }

  @Delete('trips/:tripId/stops/:stopId')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  removeStop(
    @Tenant() tenant: TenantContext,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodParam('stopId', UuidSchema) stopId: string,
  ): Promise<DeliveryTripDTO> {
    return this.dispatch.removeStop(tenant.restaurantId, tripId, stopId);
  }

  /** The restaurant decides the delivery order by hand. */
  @Put('trips/:tripId/sequence')
  @RequirePermission('dispatch.manage')
  reorder(
    @Tenant() tenant: TenantContext,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodBody(ReorderStopsSchema) body: z.infer<typeof ReorderStopsSchema>,
  ): Promise<DeliveryTripDTO> {
    return this.dispatch.reorderStops(tenant.restaurantId, tripId, body.stopIds);
  }

  /** The route optimiser decides the delivery order. */
  @Post('trips/:tripId/optimize')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  optimize(@Tenant() tenant: TenantContext, @ZodParam('tripId', UuidSchema) tripId: string): Promise<DeliveryTripDTO> {
    return this.dispatch.optimizeStops(tenant.restaurantId, tripId);
  }

  // Staff may drive a trip on the courier's behalf (a courier without the app).
  @Post('trips/:tripId/pickup')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  pickup(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
  ): Promise<DeliveryTripDTO> {
    return this.dispatch.pickup(tenant.restaurantId, tripId, staff(user));
  }

  @Post('trips/:tripId/start')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  start(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
  ): Promise<DeliveryTripDTO> {
    return this.dispatch.start(tenant.restaurantId, tripId, staff(user));
  }

  @Post('trips/:tripId/stops/:stopId/deliver')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  deliver(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodParam('stopId', UuidSchema) stopId: string,
    @ZodBody(DeliverStopSchema) body: DeliverStopInput,
  ): Promise<DeliveryTripDTO> {
    // Staff may deliver without the customer's code (docs/TESLIMAT_KODU.md); the stop records how.
    return this.dispatch.deliver(tenant.restaurantId, tripId, stopId, staff(user), body.code);
  }

  @Post('trips/:tripId/stops/:stopId/fail')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  fail(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodParam('stopId', UuidSchema) stopId: string,
    @ZodBody(StopFailureSchema) body: z.infer<typeof StopFailureSchema>,
  ): Promise<DeliveryTripDTO> {
    return this.dispatch.fail(tenant.restaurantId, tripId, stopId, body.reason, staff(user));
  }

  @Post('trips/:tripId/cancel')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  cancel(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodBody(CancelTripSchema) body: z.infer<typeof CancelTripSchema>,
  ): Promise<DeliveryTripDTO> {
    return this.dispatch.cancel(tenant.restaurantId, tripId, body.reason, staff(user));
  }
}
