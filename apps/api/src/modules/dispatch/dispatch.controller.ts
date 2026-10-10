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
  maskTripContacts,
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
/** A trip as the caller may read it: stop phones are masked without customers.contact.view, like the order endpoints. */
const viewTrip = (trip: DeliveryTripDTO, tenant: TenantContext): DeliveryTripDTO =>
  contacts(tenant) ? trip : maskTripContacts(trip);
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
  async board(@Tenant() tenant: TenantContext): Promise<DispatchBoardDTO> {
    const board = await this.dispatch.board(tenant.restaurantId, contacts(tenant));
    return { ...board, activeTrips: board.activeTrips.map((t) => viewTrip(t, tenant)) };
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
  async trips(
    @Tenant() tenant: TenantContext,
    @ZodQuery(TripsListSchema) query: z.infer<typeof TripsQuerySchema>,
  ): Promise<DeliveryTripDTO[]> {
    const trips = await this.dispatch.listTrips(tenant.restaurantId, { status: query.status, limit: query.limit });
    return trips.map((t) => viewTrip(t, tenant));
  }

  @Post('trips')
  @RequirePermission('dispatch.manage')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateTripSchema) body: z.infer<typeof CreateTripSchema>,
  ): Promise<DeliveryTripDTO> {
    return viewTrip(await this.dispatch.createTrip(tenant.restaurantId, body, staff(user)), tenant);
  }

  @Get('trips/:tripId')
  @RequirePermission('dispatch.view')
  async trip(
    @Tenant() tenant: TenantContext,
    @ZodParam('tripId', UuidSchema) tripId: string,
  ): Promise<DeliveryTripDTO> {
    return viewTrip(await this.dispatch.getTrip(tenant.restaurantId, tripId), tenant);
  }

  @Put('trips/:tripId/courier')
  @RequirePermission('dispatch.manage')
  async assign(
    @Tenant() tenant: TenantContext,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodBody(AssignCourierSchema) body: z.infer<typeof AssignCourierSchema>,
  ): Promise<DeliveryTripDTO> {
    return viewTrip(await this.dispatch.assignCourier(tenant.restaurantId, tripId, body.courierMembershipId), tenant);
  }

  @Post('trips/:tripId/stops')
  @RequirePermission('dispatch.manage')
  async addStop(
    @Tenant() tenant: TenantContext,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodBody(AddStopSchema) body: z.infer<typeof AddStopSchema>,
  ): Promise<DeliveryTripDTO> {
    return viewTrip(await this.dispatch.addStop(tenant.restaurantId, tripId, body.orderId), tenant);
  }

  @Delete('trips/:tripId/stops/:stopId')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  async removeStop(
    @Tenant() tenant: TenantContext,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodParam('stopId', UuidSchema) stopId: string,
  ): Promise<DeliveryTripDTO> {
    return viewTrip(await this.dispatch.removeStop(tenant.restaurantId, tripId, stopId), tenant);
  }

  /** The restaurant decides the delivery order by hand. */
  @Put('trips/:tripId/sequence')
  @RequirePermission('dispatch.manage')
  async reorder(
    @Tenant() tenant: TenantContext,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodBody(ReorderStopsSchema) body: z.infer<typeof ReorderStopsSchema>,
  ): Promise<DeliveryTripDTO> {
    return viewTrip(await this.dispatch.reorderStops(tenant.restaurantId, tripId, body.stopIds), tenant);
  }

  /** The route optimiser decides the delivery order. */
  @Post('trips/:tripId/optimize')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  async optimize(
    @Tenant() tenant: TenantContext,
    @ZodParam('tripId', UuidSchema) tripId: string,
  ): Promise<DeliveryTripDTO> {
    return viewTrip(await this.dispatch.optimizeStops(tenant.restaurantId, tripId), tenant);
  }

  // Staff may drive a trip on the courier's behalf (a courier without the app).
  @Post('trips/:tripId/pickup')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  async pickup(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
  ): Promise<DeliveryTripDTO> {
    return viewTrip(await this.dispatch.pickup(tenant.restaurantId, tripId, staff(user)), tenant);
  }

  @Post('trips/:tripId/start')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  async start(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
  ): Promise<DeliveryTripDTO> {
    return viewTrip(await this.dispatch.start(tenant.restaurantId, tripId, staff(user)), tenant);
  }

  @Post('trips/:tripId/stops/:stopId/deliver')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  async deliver(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodParam('stopId', UuidSchema) stopId: string,
    @ZodBody(DeliverStopSchema) body: DeliverStopInput,
  ): Promise<DeliveryTripDTO> {
    // Staff may deliver without the customer's code (docs/TESLIMAT_KODU.md); the stop records how.
    return viewTrip(await this.dispatch.deliver(tenant.restaurantId, tripId, stopId, staff(user), body.code), tenant);
  }

  @Post('trips/:tripId/stops/:stopId/fail')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  async fail(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodParam('stopId', UuidSchema) stopId: string,
    @ZodBody(StopFailureSchema) body: z.infer<typeof StopFailureSchema>,
  ): Promise<DeliveryTripDTO> {
    return viewTrip(await this.dispatch.fail(tenant.restaurantId, tripId, stopId, body.reason, staff(user)), tenant);
  }

  @Post('trips/:tripId/cancel')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  async cancel(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodBody(CancelTripSchema) body: z.infer<typeof CancelTripSchema>,
  ): Promise<DeliveryTripDTO> {
    return viewTrip(await this.dispatch.cancel(tenant.restaurantId, tripId, body.reason, staff(user)), tenant);
  }
}
