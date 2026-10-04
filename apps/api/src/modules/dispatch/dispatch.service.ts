import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { dispatchSettingsFrom, estimateStopEtas, optimizeStopOrder, orderShortCode } from '@resget/shared';
import type {
  CourierSummaryDTO,
  CreateTripInput,
  DeliveryStopDTO,
  DeliveryTripDTO,
  DispatchBoardDTO,
  DispatchSettings,
  GeoPoint,
  OrderActor,
  RoutableStop,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService, courierTopic, dispatchTopic } from '../realtime/realtime.service';
import type { TopicEvent } from '../realtime/realtime.service';
import { ACTIVE_STOP_STATUSES, ACTIVE_TRIP_STATUSES, OrdersService } from '../orders/orders.service';
import { OrderNotificationsService } from '../orders/order-notifications.service';
import { PushService } from '../push/push.service';
import type { TenantContext } from '../auth/tenant-context';
import { RoutingRegistry } from './routing.registry';
import { conflict, forbidden, notFound } from '../../common/api-error';

const tripArgs = Prisma.validator<Prisma.DeliveryTripDefaultArgs>()({
  include: {
    stops: {
      where: { status: { not: 'REMOVED' } },
      orderBy: { sequence: 'asc' },
      include: { order: { select: { id: true, status: true, addressSnapshot: true } } },
    },
    courier: { include: { user: { select: { id: true, fullName: true, phone: true } }, courierLocation: true } },
  },
});
type TripRow = Prisma.DeliveryTripGetPayload<typeof tripArgs>;
type StopRow = TripRow['stops'][number];

/** Statuses an order may have when it is added to a trip: ready, or still in the kitchen (planning ahead). */
const DISPATCHABLE_ORDER_STATUSES = ['ACCEPTED', 'PREPARING', 'READY'] as const;

export interface Actor {
  userId: string;
  role: OrderActor;
}

/**
 * Trips of the restaurant's own couriers (docs/SIPARIS_VE_SEVK.md). A trip
 * groups ready delivery orders, gets a courier, a stop order (by hand or by
 * the route optimiser) and then runs stop by stop. Every change is pushed to
 * the dispatch board, the courier and each customer.
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly orders: OrdersService,
    private readonly routing: RoutingRegistry,
    private readonly notifications: OrderNotificationsService,
    private readonly push: PushService,
  ) {
    this.orders.setTripEventsProvider((tripId) => this.eventsForTrip(tripId));
  }

  // -- Reads --------------------------------------------------------------------

  async board(restaurantId: string, canSeeContacts: boolean): Promise<DispatchBoardDTO> {
    const [settings, readyOrders, upcomingOrders, trips, couriers] = await Promise.all([
      this.settingsOf(restaurantId),
      this.orders.list(restaurantId, { status: ['READY'], fulfillment: 'DELIVERY', limit: 200 }, canSeeContacts),
      this.orders.list(
        restaurantId,
        { status: ['PLACED', 'ACCEPTED', 'PREPARING'], fulfillment: 'DELIVERY', limit: 200 },
        canSeeContacts,
      ),
      this.prisma.deliveryTrip.findMany({
        where: { restaurantId, status: { in: [...ACTIVE_TRIP_STATUSES] } },
        orderBy: { createdAt: 'asc' },
        ...tripArgs,
      }),
      this.couriersOf(restaurantId),
    ]);
    return {
      readyOrders: readyOrders.filter((o) => !o.activeTrip),
      upcomingOrders: upcomingOrders.filter((o) => !o.activeTrip),
      activeTrips: trips.map((t) => this.toTrip(t)),
      couriers,
      settings,
    };
  }

  async listTrips(
    restaurantId: string,
    filter: { status?: readonly TripRow['status'][]; courierMembershipId?: string; limit: number },
  ): Promise<DeliveryTripDTO[]> {
    const trips = await this.prisma.deliveryTrip.findMany({
      where: {
        restaurantId,
        ...(filter.status ? { status: { in: [...filter.status] } } : {}),
        ...(filter.courierMembershipId ? { courierMembershipId: filter.courierMembershipId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filter.limit,
      ...tripArgs,
    });
    return trips.map((t) => this.toTrip(t));
  }

  async getTrip(restaurantId: string, tripId: string): Promise<DeliveryTripDTO> {
    return this.toTrip(await this.loadTrip(this.prisma, restaurantId, tripId));
  }

  /** Staff with dispatch.manage may act on any trip; a courier only on the trips assigned to them. */
  assertMayDrive(trip: Pick<TripRow, 'courierMembershipId'>, tenant: TenantContext): void {
    if (tenant.isSuperAdmin || tenant.permissions.has('dispatch.manage')) return;
    if (tenant.membershipId && trip.courierMembershipId === tenant.membershipId) return;
    throw forbidden('COURIER_NOT_ASSIGNED', 'Trip is not assigned to the caller');
  }

  async couriersOf(restaurantId: string): Promise<CourierSummaryDTO[]> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        restaurantId,
        status: 'ACTIVE',
        roleTemplate: { OR: [{ isOwner: true }, { permissions: { some: { permissionKey: 'courier.deliver' } } }] },
      },
      select: {
        id: true,
        user: { select: { id: true, fullName: true, phone: true } },
        courierLocation: true,
        courierTrips: { where: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] } }, select: { id: true }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      fullName: m.user.fullName,
      phone: m.user.phone,
      position: m.courierLocation ? this.toPosition(m.courierLocation) : null,
      activeTripId: m.courierTrips[0]?.id ?? null,
    }));
  }

  // -- Trip lifecycle ----------------------------------------------------------------

  async createTrip(restaurantId: string, input: CreateTripInput, actor: Actor): Promise<DeliveryTripDTO> {
    const settings = await this.settingsOf(restaurantId);
    if (input.orderIds.length > settings.maxStopsPerTrip) {
      throw conflict('TRIP_TOO_MANY_STOPS', `At most ${settings.maxStopsPerTrip} stops per trip`);
    }
    const orders = await this.dispatchableOrders(this.prisma, restaurantId, input.orderIds);
    const branchId = orders[0].branchId;
    if (orders.some((o) => o.branchId !== branchId)) {
      throw conflict('TRIP_STOP_INVALID', 'All orders of a trip must belong to the same branch');
    }
    const courierMembershipId = input.courierMembershipId
      ? await this.assertCourier(restaurantId, input.courierMembershipId)
      : null;

    const tripId = await this.prisma.$transaction(async (tx) => {
      const trip = await tx.deliveryTrip.create({
        data: {
          restaurantId,
          branchId,
          courierMembershipId,
          createdByUserId: actor.userId,
          status: courierMembershipId ? 'ASSIGNED' : 'PLANNED',
          sequenceMode: input.sequenceMode,
          assignedAt: courierMembershipId ? new Date() : null,
        },
        select: { id: true },
      });
      // Keep the given order; the optimiser below replaces it when asked.
      let sequence = 0;
      for (const orderId of input.orderIds) {
        const order = orders.find((o) => o.id === orderId)!;
        const point = this.orders.addressOf(order)?.point ?? null;
        sequence += 1;
        await tx.deliveryStop.create({
          data: { tripId: trip.id, restaurantId, orderId, sequence, lat: point?.lat, lng: point?.lng },
        });
        await tx.order.update({ where: { id: orderId }, data: { deliveryMode: 'RESTAURANT_COURIER' } });
      }
      return trip.id;
    });
    if (input.sequenceMode === 'OPTIMIZED') await this.optimizeStops(restaurantId, tripId);
    else await this.refreshEstimates(restaurantId, tripId);
    await this.publishTrip(tripId);
    return this.getTrip(restaurantId, tripId);
  }

  async assignCourier(restaurantId: string, tripId: string, courierMembershipId: string): Promise<DeliveryTripDTO> {
    const trip = await this.loadTrip(this.prisma, restaurantId, tripId);
    if (trip.status !== 'PLANNED' && trip.status !== 'ASSIGNED') {
      throw conflict('TRIP_STATE_INVALID', 'Courier can only change before departure');
    }
    await this.assertCourier(restaurantId, courierMembershipId);
    const previous = trip.courierMembershipId;
    await this.prisma.deliveryTrip.update({
      where: { id: tripId },
      data: { courierMembershipId, status: 'ASSIGNED', assignedAt: new Date() },
    });
    await this.publishTrip(tripId, previous && previous !== courierMembershipId ? [previous] : []);
    if (previous !== courierMembershipId)
      await this.pushTripAssigned(restaurantId, tripId, courierMembershipId, trip.stops.length);
    return this.getTrip(restaurantId, tripId);
  }

  /** The courier's phone learns about a new trip even when the app is closed (docs/MESAJLASMA.md, push). */
  private async pushTripAssigned(
    restaurantId: string,
    tripId: string,
    membershipId: string,
    stops: number,
  ): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      select: { userId: true, restaurant: { select: { name: true, defaultLocale: true } } },
    });
    if (!membership) return;
    await this.push.notifyUsers(
      [membership.userId],
      'trip.assigned',
      { restaurant: membership.restaurant.name, count: stops },
      { kind: 'trip', tripId },
      { restaurantId, localeFallback: membership.restaurant.defaultLocale },
    );
  }

  async addStop(restaurantId: string, tripId: string, orderId: string): Promise<DeliveryTripDTO> {
    const trip = await this.loadTrip(this.prisma, restaurantId, tripId);
    if (trip.status !== 'PLANNED' && trip.status !== 'ASSIGNED') {
      throw conflict('TRIP_STATE_INVALID', 'Stops can only be added before departure');
    }
    const settings = await this.settingsOf(restaurantId);
    if (trip.stops.length + 1 > settings.maxStopsPerTrip) {
      throw conflict('TRIP_TOO_MANY_STOPS', `At most ${settings.maxStopsPerTrip} stops per trip`);
    }
    const [order] = await this.dispatchableOrders(this.prisma, restaurantId, [orderId]);
    if (order.branchId !== trip.branchId) throw conflict('TRIP_STOP_INVALID', 'Order belongs to another branch');
    const point = this.orders.addressOf(order)?.point ?? null;
    await this.prisma.$transaction([
      this.prisma.deliveryStop.create({
        data: {
          tripId,
          restaurantId,
          orderId,
          sequence: (trip.stops.at(-1)?.sequence ?? 0) + 1,
          lat: point?.lat,
          lng: point?.lng,
        },
      }),
      this.prisma.order.update({ where: { id: orderId }, data: { deliveryMode: 'RESTAURANT_COURIER' } }),
    ]);
    if (trip.sequenceMode === 'OPTIMIZED') await this.optimizeStops(restaurantId, tripId);
    else await this.refreshEstimates(restaurantId, tripId);
    await this.publishTrip(tripId);
    return this.getTrip(restaurantId, tripId);
  }

  async removeStop(restaurantId: string, tripId: string, stopId: string): Promise<DeliveryTripDTO> {
    const trip = await this.loadTrip(this.prisma, restaurantId, tripId);
    const stop = trip.stops.find((s) => s.id === stopId);
    if (!stop) throw notFound('TRIP_STOP_INVALID', 'Stop not found');
    if (trip.status !== 'PLANNED' && trip.status !== 'ASSIGNED') {
      throw conflict('TRIP_STATE_INVALID', 'Stops can only be removed before departure');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryStop.update({ where: { id: stopId }, data: { status: 'REMOVED' } });
      if (stop.order.status === 'HANDED_TO_COURIER') {
        await this.orders.applyTransition(
          tx,
          await this.orders.loadRow(tx, stop.orderId),
          'READY',
          'RESTAURANT',
          null,
          {
            reason: 'removed from trip',
          },
        );
      }
      await this.renumber(tx, tripId);
    });
    await this.refreshEstimates(restaurantId, tripId);
    await this.publishTrip(tripId, [], [stop.orderId]);
    await this.notifications.notify(stop.orderId, 'DELIVERED');
    return this.getTrip(restaurantId, tripId);
  }

  /**
   * The restaurant sets the order of the remaining stops by hand. After
   * departure the stop the courier is driving to stays first.
   */
  async reorderStops(restaurantId: string, tripId: string, stopIds: string[]): Promise<DeliveryTripDTO> {
    const trip = await this.loadTrip(this.prisma, restaurantId, tripId);
    if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
      throw conflict('TRIP_STATE_INVALID', 'Trip is finished');
    }
    const { fixed, movable } = this.partition(trip);
    const given = stopIds.filter((id) => !fixed.some((s) => s.id === id));
    const movableIds = movable.map((s) => s.id);
    if (
      given.length !== movableIds.length ||
      new Set(given).size !== given.length ||
      given.some((id) => !movableIds.includes(id))
    ) {
      throw conflict('TRIP_STOP_INVALID', 'stopIds must be a permutation of the remaining stops');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.applySequence(tx, trip, [...fixed, ...given.map((id) => movable.find((s) => s.id === id)!)]);
      await tx.deliveryTrip.update({ where: { id: tripId }, data: { sequenceMode: 'MANUAL' } });
    });
    await this.refreshEstimates(restaurantId, tripId);
    await this.publishTrip(tripId);
    return this.getTrip(restaurantId, tripId);
  }

  /** Shortest route for the remaining stops, from the restaurant before departure and from the courier after it. */
  async optimizeStops(restaurantId: string, tripId: string): Promise<DeliveryTripDTO> {
    const trip = await this.loadTrip(this.prisma, restaurantId, tripId);
    if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
      throw conflict('TRIP_STATE_INVALID', 'Trip is finished');
    }
    const origin = await this.originOf(trip);
    if (!origin) throw conflict('TRIP_STOP_INVALID', 'The branch has no coordinates; set them to optimise routes');
    const { fixed, movable } = this.partition(trip);
    const start = fixed.at(-1);
    const from: GeoPoint =
      start && start.lat !== null && start.lng !== null ? { lat: start.lat, lng: start.lng } : origin;
    const routableStops = movable.map((s) => this.routable(s));
    // A road engine's matrix orders by real distance; without one (or when it fails) straight lines decide.
    const adapter = this.routing.adapterFor(await this.settingsOf(restaurantId));
    const matrix = adapter.matrix
      ? await adapter
          .matrix([from, ...routableStops.filter((r) => r.point).map((r) => r.point!)])
          .catch(() => undefined)
      : undefined;
    const ordered = optimizeStopOrder(from, routableStops, matrix);
    await this.prisma.$transaction(async (tx) => {
      await this.applySequence(tx, trip, [...fixed, ...ordered.map((r) => movable.find((s) => s.id === r.id)!)]);
      await tx.deliveryTrip.update({ where: { id: tripId }, data: { sequenceMode: 'OPTIMIZED' } });
    });
    await this.refreshEstimates(restaurantId, tripId);
    await this.publishTrip(tripId);
    return this.getTrip(restaurantId, tripId);
  }

  /** The courier confirms the bags are in hand; every order of the trip becomes HANDED_TO_COURIER. */
  async pickup(restaurantId: string, tripId: string, actor: Actor): Promise<DeliveryTripDTO> {
    const trip = await this.loadTrip(this.prisma, restaurantId, tripId);
    if (trip.status !== 'ASSIGNED')
      throw conflict('TRIP_STATE_INVALID', 'Trip needs a courier and must not have departed');
    await this.prisma.$transaction(async (tx) => {
      await this.handOver(tx, trip, actor);
    });
    await this.publishTrip(tripId);
    return this.getTrip(restaurantId, tripId);
  }

  /** Departure: picks up first when that step was skipped, then every order is on the way and the first stop is en route. */
  async start(restaurantId: string, tripId: string, actor: Actor): Promise<DeliveryTripDTO> {
    const trip = await this.loadTrip(this.prisma, restaurantId, tripId);
    if (trip.status !== 'ASSIGNED')
      throw conflict('TRIP_STATE_INVALID', 'Trip needs a courier and must not have departed');
    if (trip.stops.length === 0) throw conflict('TRIP_STOP_INVALID', 'Trip has no stops');
    await this.prisma.$transaction(async (tx) => {
      if (!trip.pickedUpAt) await this.handOver(tx, trip, actor);
      for (const stop of trip.stops) {
        const order = await this.orders.loadRow(tx, stop.orderId);
        if (order.status === 'HANDED_TO_COURIER') {
          await this.orders.applyTransition(tx, order, 'OUT_FOR_DELIVERY', actor.role, actor.userId, {
            fromTrip: true,
          });
        }
      }
      await tx.deliveryStop.update({ where: { id: trip.stops[0].id }, data: { status: 'EN_ROUTE' } });
      await tx.deliveryTrip.update({ where: { id: tripId }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    });
    await this.refreshEstimates(restaurantId, tripId);
    await this.publishTrip(tripId);
    // Departure is the moment the customer wants to know about; each order gets its live tracking link.
    for (const stop of trip.stops) await this.notifications.notify(stop.orderId, 'OUT_FOR_DELIVERY');
    return this.getTrip(restaurantId, tripId);
  }

  async arrive(restaurantId: string, tripId: string, stopId: string, actor: Actor): Promise<DeliveryTripDTO> {
    const trip = await this.loadTrip(this.prisma, restaurantId, tripId);
    const stop = this.activeStop(trip, stopId);
    if (trip.status !== 'IN_PROGRESS') throw conflict('TRIP_STATE_INVALID', 'Trip has not departed');
    if (stop.status === 'ARRIVING') return this.toTrip(trip);
    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryStop.updateMany({ where: { tripId, status: 'EN_ROUTE' }, data: { status: 'PENDING' } });
      await tx.deliveryStop.update({ where: { id: stopId }, data: { status: 'ARRIVING', arrivedAt: new Date() } });
      const order = await this.orders.loadRow(tx, stop.orderId);
      if (order.status === 'OUT_FOR_DELIVERY') {
        await this.orders.applyTransition(tx, order, 'ARRIVING', actor.role, actor.userId, { fromTrip: true });
      }
    });
    await this.publishTrip(tripId);
    // Free push only: there is no paid template for arriving (docs/MESAJLASMA.md).
    await this.notifications.notify(stop.orderId, 'ARRIVING');
    return this.getTrip(restaurantId, tripId);
  }

  async deliver(restaurantId: string, tripId: string, stopId: string, actor: Actor): Promise<DeliveryTripDTO> {
    const trip = await this.loadTrip(this.prisma, restaurantId, tripId);
    const stop = this.activeStop(trip, stopId);
    if (trip.status !== 'IN_PROGRESS') throw conflict('TRIP_STATE_INVALID', 'Trip has not departed');
    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryStop.update({
        where: { id: stopId },
        data: { status: 'DELIVERED', deliveredAt: new Date(), arrivedAt: stop.arrivedAt ?? new Date() },
      });
      const order = await this.orders.loadRow(tx, stop.orderId);
      await this.orders.applyTransition(tx, order, 'DELIVERED', actor.role, actor.userId, { fromTrip: true });
      await this.advance(tx, tripId);
    });
    await this.refreshEstimates(restaurantId, tripId);
    await this.publishTrip(tripId, [], [stop.orderId]);
    return this.getTrip(restaurantId, tripId);
  }

  /** Nobody at the door, wrong address: the order returns to the restaurant as READY for a new trip or a cancellation. */
  async fail(
    restaurantId: string,
    tripId: string,
    stopId: string,
    reason: string,
    actor: Actor,
  ): Promise<DeliveryTripDTO> {
    const trip = await this.loadTrip(this.prisma, restaurantId, tripId);
    const stop = this.activeStop(trip, stopId);
    if (trip.status !== 'IN_PROGRESS') throw conflict('TRIP_STATE_INVALID', 'Trip has not departed');
    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryStop.update({
        where: { id: stopId },
        data: { status: 'FAILED', failedAt: new Date(), failureReason: reason },
      });
      const order = await this.orders.loadRow(tx, stop.orderId);
      await this.orders.applyTransition(tx, order, 'READY', actor.role, actor.userId, { reason, fromTrip: true });
      await this.advance(tx, tripId);
    });
    await this.refreshEstimates(restaurantId, tripId);
    await this.publishTrip(tripId, [], [stop.orderId]);
    return this.getTrip(restaurantId, tripId);
  }

  async cancel(
    restaurantId: string,
    tripId: string,
    reason: string | undefined,
    actor: Actor,
  ): Promise<DeliveryTripDTO> {
    const trip = await this.loadTrip(this.prisma, restaurantId, tripId);
    if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED')
      throw conflict('TRIP_STATE_INVALID', 'Trip is finished');
    const affected: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const stop of trip.stops) {
        if (!(ACTIVE_STOP_STATUSES as readonly string[]).includes(stop.status)) continue;
        await tx.deliveryStop.update({ where: { id: stop.id }, data: { status: 'REMOVED' } });
        const order = await this.orders.loadRow(tx, stop.orderId);
        if (['HANDED_TO_COURIER', 'OUT_FOR_DELIVERY', 'ARRIVING'].includes(order.status)) {
          await this.orders.applyTransition(tx, order, 'READY', actor.role, actor.userId, {
            reason: reason ?? 'trip cancelled',
            fromTrip: true,
          });
        }
        affected.push(stop.orderId);
      }
      await tx.deliveryTrip.update({
        where: { id: tripId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null },
      });
      await tx.courierLocation.updateMany({ where: { tripId }, data: { tripId: null } });
    });
    await this.publishTrip(tripId, [], affected);
    return this.getTrip(restaurantId, tripId);
  }

  // -- Estimates ---------------------------------------------------------------------

  /**
   * Recomputes distance and ETA of every remaining stop from the right
   * origin (restaurant before departure, courier afterwards) through the
   * routing adapter; stores them on the stops and the orders.
   */
  async refreshEstimates(restaurantId: string, tripId: string, from?: GeoPoint, at: Date = new Date()): Promise<void> {
    const trip = await this.loadTrip(this.prisma, restaurantId, tripId);
    if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') return;
    const origin = from ?? (await this.originOf(trip));
    if (!origin) return;
    const settings = await this.settingsOf(restaurantId);
    const remaining = trip.stops.filter((s) => (ACTIVE_STOP_STATUSES as readonly string[]).includes(s.status));
    const routable = remaining.map((s) => this.routable(s));
    const points = [origin, ...routable.filter((r) => r.point).map((r) => r.point!)];
    const legs = points.length > 1 ? await this.routing.adapterFor(settings).legs(points) : [];
    const etas = estimateStopEtas(origin, routable, legs, settings, at);
    const total = legs.reduce(
      (acc, leg) => ({ distance: acc.distance + leg.distanceMeters, duration: acc.duration + leg.durationSeconds }),
      { distance: 0, duration: 0 },
    );
    await this.prisma.$transaction(async (tx) => {
      for (const eta of etas) {
        const stop = remaining.find((s) => s.id === eta.stopId)!;
        await tx.deliveryStop.update({
          where: { id: eta.stopId },
          data: { distanceMeters: eta.distanceMeters, etaAt: eta.etaAt ? new Date(eta.etaAt) : null },
        });
        await tx.order.update({
          where: { id: stop.orderId },
          data: { estimatedDeliveryAt: eta.etaAt ? new Date(eta.etaAt) : null },
        });
      }
      if (trip.status !== 'IN_PROGRESS') {
        await tx.deliveryTrip.update({
          where: { id: tripId },
          data: {
            plannedDistanceMeters: total.distance + settings.stopServiceMinutes * 0,
            plannedDurationSeconds:
              total.duration + Math.max(0, routable.length - 1) * settings.stopServiceMinutes * 60,
          },
        });
      }
    });
  }

  // -- Events ------------------------------------------------------------------------

  async eventsForTrip(tripId: string, extraCouriers: readonly string[] = []): Promise<TopicEvent[]> {
    const trip = await this.prisma.deliveryTrip.findUnique({ where: { id: tripId }, ...tripArgs });
    if (!trip) return [];
    const dto = this.toTrip(trip);
    const events: TopicEvent[] = [
      { topic: dispatchTopic(trip.restaurantId), event: { type: 'trip.updated', trip: dto } },
    ];
    const couriers = new Set<string>(extraCouriers);
    if (trip.courierMembershipId) couriers.add(trip.courierMembershipId);
    for (const membershipId of couriers)
      events.push({ topic: courierTopic(membershipId), event: { type: 'trip.updated', trip: dto } });
    for (const stop of trip.stops) events.push(...(await this.orders.eventsForOrder(stop.orderId)));
    return events;
  }

  private async publishTrip(
    tripId: string,
    extraCouriers: readonly string[] = [],
    extraOrders: readonly string[] = [],
  ): Promise<void> {
    const events = await this.eventsForTrip(tripId, extraCouriers);
    for (const orderId of extraOrders) events.push(...(await this.orders.eventsForOrder(orderId)));
    this.realtime.publishMany(events);
  }

  // -- Internals ------------------------------------------------------------------------

  async settingsOf(restaurantId: string): Promise<DispatchSettings> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { dispatchSettings: true },
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    return dispatchSettingsFrom(restaurant.dispatchSettings);
  }

  async loadTrip(db: Prisma.TransactionClient | PrismaService, restaurantId: string, tripId: string): Promise<TripRow> {
    const trip = await db.deliveryTrip.findFirst({ where: { id: tripId, restaurantId }, ...tripArgs });
    if (!trip) throw notFound('TRIP_NOT_FOUND', 'Trip not found');
    return trip;
  }

  private async dispatchableOrders(db: PrismaService, restaurantId: string, orderIds: string[]) {
    if (new Set(orderIds).size !== orderIds.length) throw conflict('TRIP_STOP_INVALID', 'Duplicate order ids');
    const orders = await db.order.findMany({
      where: { id: { in: orderIds }, restaurantId },
      select: {
        id: true,
        branchId: true,
        fulfillment: true,
        status: true,
        addressSnapshot: true,
        deliveryStops: {
          where: { status: { in: [...ACTIVE_STOP_STATUSES] }, trip: { status: { in: [...ACTIVE_TRIP_STATUSES] } } },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (orders.length !== orderIds.length) throw notFound('ORDER_NOT_FOUND', 'An order was not found');
    for (const order of orders) {
      if (
        order.fulfillment !== 'DELIVERY' ||
        !(DISPATCHABLE_ORDER_STATUSES as readonly string[]).includes(order.status)
      ) {
        throw conflict('ORDER_NOT_DISPATCHABLE', `Order ${order.id} is ${order.fulfillment} ${order.status}`);
      }
      if (order.deliveryStops.length > 0)
        throw conflict('ORDER_NOT_DISPATCHABLE', `Order ${order.id} is already in a trip`);
    }
    return orderIds.map((id) => orders.find((o) => o.id === id)!);
  }

  private async assertCourier(restaurantId: string, membershipId: string): Promise<string> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, restaurantId, status: 'ACTIVE' },
      select: {
        id: true,
        roleTemplate: { select: { isOwner: true, permissions: { select: { permissionKey: true } } } },
      },
    });
    const allowed =
      membership &&
      (membership.roleTemplate.isOwner ||
        membership.roleTemplate.permissions.some((p) => p.permissionKey === 'courier.deliver'));
    if (!allowed) throw conflict('COURIER_INVALID', 'Membership is not a courier of this restaurant');
    return membership.id;
  }

  private async handOver(tx: Prisma.TransactionClient, trip: TripRow, actor: Actor): Promise<void> {
    for (const stop of trip.stops) {
      if (!(ACTIVE_STOP_STATUSES as readonly string[]).includes(stop.status)) continue;
      const order = await this.orders.loadRow(tx, stop.orderId);
      if (order.status === 'HANDED_TO_COURIER') continue;
      if (order.status !== 'READY') {
        throw conflict('TRIP_STATE_INVALID', `Order ${orderShortCode(order.id)} is not ready yet (${order.status})`);
      }
      await this.orders.applyTransition(tx, order, 'HANDED_TO_COURIER', actor.role, actor.userId, { fromTrip: true });
    }
    await tx.deliveryTrip.update({ where: { id: trip.id }, data: { pickedUpAt: trip.pickedUpAt ?? new Date() } });
  }

  /** After a stop ends: the next pending stop becomes en route, or the trip completes. */
  private async advance(tx: Prisma.TransactionClient, tripId: string): Promise<void> {
    const remaining = await tx.deliveryStop.findMany({
      where: { tripId, status: { in: [...ACTIVE_STOP_STATUSES] } },
      orderBy: { sequence: 'asc' },
      select: { id: true, status: true },
    });
    if (remaining.length === 0) {
      await tx.deliveryTrip.update({ where: { id: tripId }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await tx.courierLocation.updateMany({ where: { tripId }, data: { tripId: null } });
      return;
    }
    if (!remaining.some((s) => s.status === 'EN_ROUTE' || s.status === 'ARRIVING')) {
      await tx.deliveryStop.update({ where: { id: remaining[0].id }, data: { status: 'EN_ROUTE' } });
    }
  }

  private activeStop(trip: TripRow, stopId: string): StopRow {
    const stop = trip.stops.find((s) => s.id === stopId);
    if (!stop) throw notFound('TRIP_STOP_INVALID', 'Stop not found');
    if (!(ACTIVE_STOP_STATUSES as readonly string[]).includes(stop.status)) {
      throw conflict('TRIP_STATE_INVALID', `Stop is already ${stop.status}`);
    }
    return stop;
  }

  /** Finished stops and, after departure, the stop being driven to stay where they are; the rest can move. */
  private partition(trip: TripRow): { fixed: StopRow[]; movable: StopRow[] } {
    const finished = trip.stops.filter((s) => !(ACTIVE_STOP_STATUSES as readonly string[]).includes(s.status));
    const active = trip.stops.filter((s) => (ACTIVE_STOP_STATUSES as readonly string[]).includes(s.status));
    if (trip.status === 'IN_PROGRESS' && active.length > 0) {
      const current = active.find((s) => s.status === 'EN_ROUTE' || s.status === 'ARRIVING') ?? active[0];
      return { fixed: [...finished, current], movable: active.filter((s) => s.id !== current.id) };
    }
    return { fixed: finished, movable: active };
  }

  private async applySequence(tx: Prisma.TransactionClient, trip: TripRow, ordered: StopRow[]): Promise<void> {
    // Two passes keep the sequence unique at every point; the column has no unique index but screens sort by it.
    let sequence = 0;
    for (const stop of ordered) {
      sequence += 1;
      await tx.deliveryStop.update({ where: { id: stop.id }, data: { sequence: sequence + 1000 } });
    }
    sequence = 0;
    for (const stop of ordered) {
      sequence += 1;
      await tx.deliveryStop.update({ where: { id: stop.id }, data: { sequence } });
    }
    void trip;
  }

  private async renumber(tx: Prisma.TransactionClient, tripId: string): Promise<void> {
    const stops = await tx.deliveryStop.findMany({
      where: { tripId, status: { not: 'REMOVED' } },
      orderBy: { sequence: 'asc' },
      select: { id: true },
    });
    let sequence = 0;
    for (const stop of stops) {
      sequence += 1;
      await tx.deliveryStop.update({ where: { id: stop.id }, data: { sequence } });
    }
  }

  private async originOf(trip: TripRow): Promise<GeoPoint | null> {
    if (trip.status === 'IN_PROGRESS' && trip.courier?.courierLocation) {
      return { lat: trip.courier.courierLocation.lat, lng: trip.courier.courierLocation.lng };
    }
    const branch = await this.prisma.branch.findUnique({
      where: { id: trip.branchId },
      select: { lat: true, lng: true },
    });
    return branch && branch.lat !== null && branch.lng !== null ? { lat: branch.lat, lng: branch.lng } : null;
  }

  private routable(stop: StopRow): RoutableStop {
    return { id: stop.id, point: stop.lat !== null && stop.lng !== null ? { lat: stop.lat, lng: stop.lng } : null };
  }

  private toPosition(location: NonNullable<TripRow['courier']>['courierLocation']) {
    if (!location) return null;
    return {
      lat: location.lat,
      lng: location.lng,
      headingDeg: location.headingDeg,
      speedMps: location.speedMps,
      accuracyM: location.accuracyM,
      recordedAt: location.recordedAt.toISOString(),
    };
  }

  toTrip(trip: TripRow): DeliveryTripDTO {
    const stops: DeliveryStopDTO[] = trip.stops.map((stop) => ({
      id: stop.id,
      tripId: stop.tripId,
      orderId: stop.orderId,
      orderShortCode: orderShortCode(stop.orderId),
      orderStatus: stop.order.status,
      sequence: stop.sequence,
      status: stop.status,
      point: stop.lat !== null && stop.lng !== null ? { lat: stop.lat, lng: stop.lng } : null,
      address: this.orders.addressOf(stop.order),
      distanceMeters: stop.distanceMeters,
      etaAt: stop.etaAt?.toISOString() ?? null,
      arrivedAt: stop.arrivedAt?.toISOString() ?? null,
      deliveredAt: stop.deliveredAt?.toISOString() ?? null,
      failedAt: stop.failedAt?.toISOString() ?? null,
      failureReason: stop.failureReason,
    }));
    return {
      id: trip.id,
      restaurantId: trip.restaurantId,
      branchId: trip.branchId,
      status: trip.status,
      sequenceMode: trip.sequenceMode,
      courier: trip.courier
        ? {
            membershipId: trip.courier.id,
            userId: trip.courier.user.id,
            fullName: trip.courier.user.fullName,
            phone: trip.courier.user.phone,
            position: this.toPosition(trip.courier.courierLocation),
            activeTripId: trip.status === 'ASSIGNED' || trip.status === 'IN_PROGRESS' ? trip.id : null,
          }
        : null,
      stops,
      plannedDistanceMeters: trip.plannedDistanceMeters,
      plannedDurationSeconds: trip.plannedDurationSeconds,
      createdAt: trip.createdAt.toISOString(),
      assignedAt: trip.assignedAt?.toISOString() ?? null,
      pickedUpAt: trip.pickedUpAt?.toISOString() ?? null,
      startedAt: trip.startedAt?.toISOString() ?? null,
      completedAt: trip.completedAt?.toISOString() ?? null,
      cancelledAt: trip.cancelledAt?.toISOString() ?? null,
      cancelReason: trip.cancelReason,
    };
  }
}
