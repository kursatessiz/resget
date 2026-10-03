import { Injectable } from '@nestjs/common';
import { estimateStopEtas, haversineMeters } from '@resget/shared';
import type { GeoPoint, LocationPingInput, RoutableStop, StopEta } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService, dispatchTopic } from '../realtime/realtime.service';
import { ACTIVE_STOP_STATUSES, OrdersService } from '../orders/orders.service';
import { DispatchService } from './dispatch.service';
import { RoutingRegistry } from './routing.registry';

export interface LocationIngestResult {
  /** False when the courier has no active trip: nothing is stored or shared. */
  tracked: boolean;
  accepted: number;
  tripId: string | null;
  currentStopId: string | null;
  /** The geofence of the current stop was entered with this batch. */
  arrived: boolean;
  stops: StopEta[];
}

/** Trail samples are kept only when the courier moved at least this far or this long since the last one. */
const SAMPLE_MIN_METERS = 20;
const SAMPLE_MIN_SECONDS = 15;

/**
 * Courier positions (docs/SIPARIS_VE_SEVK.md): accepted only while the
 * courier drives a trip, stored once as the latest position plus a
 * downsampled trail, turned into fresh ETAs for the remaining stops, pushed
 * to the dispatch board and to each customer whose order is on the way, and
 * checked against the arrival geofence of the stop being driven to.
 */
@Injectable()
export class LocationService {
  private readonly lastBroadcast = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly orders: OrdersService,
    private readonly dispatch: DispatchService,
    private readonly routing: RoutingRegistry,
  ) {}

  async ingest(
    restaurantId: string,
    membershipId: string,
    actorUserId: string,
    input: LocationPingInput,
  ): Promise<LocationIngestResult> {
    const trip = await this.prisma.deliveryTrip.findFirst({
      where: { restaurantId, courierMembershipId: membershipId, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    if (!trip) return { tracked: false, accepted: 0, tripId: null, currentStopId: null, arrived: false, stops: [] };

    const points = [...input.points].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const latest = points[points.length - 1];
    const existing = await this.prisma.courierLocation.findUnique({ where: { membershipId } });
    const latestAt = new Date(latest.recordedAt);
    if (!existing || existing.recordedAt <= latestAt) {
      await this.prisma.courierLocation.upsert({
        where: { membershipId },
        update: {
          restaurantId,
          tripId: trip.id,
          lat: latest.lat,
          lng: latest.lng,
          headingDeg: latest.headingDeg ?? null,
          speedMps: latest.speedMps ?? null,
          accuracyM: latest.accuracyM ?? null,
          recordedAt: latestAt,
        },
        create: {
          membershipId,
          restaurantId,
          tripId: trip.id,
          lat: latest.lat,
          lng: latest.lng,
          headingDeg: latest.headingDeg ?? null,
          speedMps: latest.speedMps ?? null,
          accuracyM: latest.accuracyM ?? null,
          recordedAt: latestAt,
        },
      });
    }
    await this.appendSamples(trip.id, membershipId, points);

    if (trip.status !== 'IN_PROGRESS') {
      return {
        tracked: true,
        accepted: points.length,
        tripId: trip.id,
        currentStopId: null,
        arrived: false,
        stops: [],
      };
    }

    const position: GeoPoint = { lat: latest.lat, lng: latest.lng };
    const settings = await this.dispatch.settingsOf(restaurantId);
    const remaining = await this.prisma.deliveryStop.findMany({
      where: { tripId: trip.id, status: { in: [...ACTIVE_STOP_STATUSES] } },
      orderBy: { sequence: 'asc' },
      select: { id: true, orderId: true, status: true, lat: true, lng: true },
    });
    const current = remaining.find((s) => s.status === 'EN_ROUTE' || s.status === 'ARRIVING') ?? remaining[0] ?? null;

    let arrived = false;
    if (current && current.status === 'EN_ROUTE' && current.lat !== null && current.lng !== null) {
      const distance = haversineMeters(position, { lat: current.lat, lng: current.lng });
      if (distance <= settings.arrivalRadiusMeters) {
        await this.dispatch.arrive(restaurantId, trip.id, current.id, { userId: actorUserId, role: 'SYSTEM' });
        arrived = true;
      }
    }

    const routable: RoutableStop[] = remaining.map((s) => ({
      id: s.id,
      point: s.lat !== null && s.lng !== null ? { lat: s.lat, lng: s.lng } : null,
    }));
    const routePoints = [position, ...routable.filter((r) => r.point).map((r) => r.point!)];
    const legs = routePoints.length > 1 ? await this.routing.adapterFor(settings).legs(routePoints) : [];
    const stops = estimateStopEtas(position, routable, legs, settings, latestAt);
    await this.prisma.$transaction(async (tx) => {
      for (const eta of stops) {
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
    });

    // Fan out at most every locationBroadcastSeconds per trip; an arrival already published everything.
    const now = Date.now();
    const last = this.lastBroadcast.get(trip.id) ?? 0;
    if (!arrived && now - last >= settings.locationBroadcastSeconds * 1000) {
      this.lastBroadcast.set(trip.id, now);
      const events =
        remaining.length > 0 ? await Promise.all(remaining.map((s) => this.orders.eventsForOrder(s.orderId))) : [];
      this.realtime.publishMany([
        {
          topic: dispatchTopic(restaurantId),
          event: {
            type: 'courier.location',
            tripId: trip.id,
            membershipId,
            position: {
              lat: latest.lat,
              lng: latest.lng,
              headingDeg: latest.headingDeg ?? null,
              speedMps: latest.speedMps ?? null,
              accuracyM: latest.accuracyM ?? null,
              recordedAt: latestAt.toISOString(),
            },
            stops,
          },
        },
        // Customers get only their own order's tracking view.
        ...events.flat().filter((e) => e.event.type === 'tracking.updated'),
      ]);
    }

    return {
      tracked: true,
      accepted: points.length,
      tripId: trip.id,
      currentStopId: current?.id ?? null,
      arrived,
      stops,
    };
  }

  private async appendSamples(
    tripId: string,
    membershipId: string,
    points: LocationPingInput['points'],
  ): Promise<void> {
    const last = await this.prisma.courierLocationSample.findFirst({
      where: { tripId },
      orderBy: { recordedAt: 'desc' },
      select: { lat: true, lng: true, recordedAt: true },
    });
    let previous = last ? { lat: last.lat, lng: last.lng, at: last.recordedAt.getTime() } : null;
    const rows: { tripId: string; membershipId: string; lat: number; lng: number; recordedAt: Date }[] = [];
    for (const point of points) {
      const at = new Date(point.recordedAt).getTime();
      if (previous) {
        const moved = haversineMeters(previous, point) >= SAMPLE_MIN_METERS;
        const waited = at - previous.at >= SAMPLE_MIN_SECONDS * 1000;
        if (at <= previous.at || (!moved && !waited)) continue;
      }
      rows.push({ tripId, membershipId, lat: point.lat, lng: point.lng, recordedAt: new Date(at) });
      previous = { lat: point.lat, lng: point.lng, at };
    }
    if (rows.length > 0) await this.prisma.courierLocationSample.createMany({ data: rows });
  }
}
