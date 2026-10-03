import { Controller, Get, Headers, HttpCode, Post, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { z } from 'zod';
import { LocationPingSchema, StopFailureSchema, UuidSchema } from '@resget/shared';
import type { DeliveryTripDTO } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { RealtimeService, courierTopic } from '../realtime/realtime.service';
import { forbidden } from '../../common/api-error';
import { DispatchService } from './dispatch.service';
import { LocationService } from './location.service';
import type { LocationIngestResult } from './location.service';

const courier = (user: AuthUser) => ({ userId: user.id, role: 'COURIER' as const });

/**
 * What the courier's screens of the app call: their own trips, the steps of
 * a delivery and the position pings. A courier never sees other couriers'
 * trips; staff with dispatch.manage use the dispatch endpoints instead.
 */
@Controller('restaurants/:restaurantId/courier/me')
@RestaurantScoped()
export class CourierController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly location: LocationService,
    private readonly realtime: RealtimeService,
  ) {}

  private membershipOf(tenant: TenantContext): string {
    if (!tenant.membershipId) throw forbidden('COURIER_NOT_ASSIGNED', 'Super admins have no courier identity');
    return tenant.membershipId;
  }

  @Get('trips')
  @RequirePermission('courier.deliver')
  trips(@Tenant() tenant: TenantContext): Promise<DeliveryTripDTO[]> {
    return this.dispatch.listTrips(tenant.restaurantId, {
      courierMembershipId: this.membershipOf(tenant),
      status: ['ASSIGNED', 'IN_PROGRESS'],
      limit: 20,
    });
  }

  @Get('trips/:tripId')
  @RequirePermission('courier.deliver')
  async trip(
    @Tenant() tenant: TenantContext,
    @ZodParam('tripId', UuidSchema) tripId: string,
  ): Promise<DeliveryTripDTO> {
    const trip = await this.dispatch.loadTrip(this.dispatch['prisma'], tenant.restaurantId, tripId);
    this.dispatch.assertMayDrive(trip, tenant);
    return this.dispatch.toTrip(trip);
  }

  /** SSE: trip.updated and order.updated for the trips assigned to this courier. */
  @Sse('events')
  @RequirePermission('courier.deliver')
  events(@Tenant() tenant: TenantContext, @Headers('last-event-id') lastEventId?: string): Observable<MessageEvent> {
    return this.realtime.stream(courierTopic(this.membershipOf(tenant)), lastEventId);
  }

  @Post('trips/:tripId/pickup')
  @HttpCode(200)
  @RequirePermission('courier.deliver')
  async pickup(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
  ): Promise<DeliveryTripDTO> {
    await this.guard(tenant, tripId);
    return this.dispatch.pickup(tenant.restaurantId, tripId, courier(user));
  }

  @Post('trips/:tripId/start')
  @HttpCode(200)
  @RequirePermission('courier.deliver')
  async start(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
  ): Promise<DeliveryTripDTO> {
    await this.guard(tenant, tripId);
    return this.dispatch.start(tenant.restaurantId, tripId, courier(user));
  }

  @Post('trips/:tripId/stops/:stopId/arrive')
  @HttpCode(200)
  @RequirePermission('courier.deliver')
  async arrive(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodParam('stopId', UuidSchema) stopId: string,
  ): Promise<DeliveryTripDTO> {
    await this.guard(tenant, tripId);
    return this.dispatch.arrive(tenant.restaurantId, tripId, stopId, courier(user));
  }

  @Post('trips/:tripId/stops/:stopId/deliver')
  @HttpCode(200)
  @RequirePermission('courier.deliver')
  async deliver(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodParam('stopId', UuidSchema) stopId: string,
  ): Promise<DeliveryTripDTO> {
    await this.guard(tenant, tripId);
    return this.dispatch.deliver(tenant.restaurantId, tripId, stopId, courier(user));
  }

  @Post('trips/:tripId/stops/:stopId/fail')
  @HttpCode(200)
  @RequirePermission('courier.deliver')
  async fail(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('tripId', UuidSchema) tripId: string,
    @ZodParam('stopId', UuidSchema) stopId: string,
    @ZodBody(StopFailureSchema) body: z.infer<typeof StopFailureSchema>,
  ): Promise<DeliveryTripDTO> {
    await this.guard(tenant, tripId);
    return this.dispatch.fail(tenant.restaurantId, tripId, stopId, body.reason, courier(user));
  }

  /** Position batches from the app; ignored (tracked: false) when no trip is active. */
  @Post('location')
  @HttpCode(200)
  @RequirePermission('courier.deliver')
  pushLocation(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(LocationPingSchema) body: z.infer<typeof LocationPingSchema>,
  ): Promise<LocationIngestResult> {
    return this.location.ingest(tenant.restaurantId, this.membershipOf(tenant), user.id, body);
  }

  private async guard(tenant: TenantContext, tripId: string): Promise<void> {
    const trip = await this.dispatch.loadTrip(this.dispatch['prisma'], tenant.restaurantId, tripId);
    this.dispatch.assertMayDrive(trip, tenant);
  }
}
