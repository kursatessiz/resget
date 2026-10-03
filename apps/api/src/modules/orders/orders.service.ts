import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@resget/database';
import {
  COURIER_LEG_STATUSES,
  TRACKING_TOKEN_BYTES,
  canTransitionOrder,
  computeModeSettlement,
  courierDisplayName,
  deliveryFeeVatBpsFor,
  dispatchSettingsFrom,
  haversineMeters,
  isTerminalOrderStatus,
  maskPhoneForDisplay,
  orderShortCode,
  orderTimestampFor,
  settlementDefaultsFor,
  trackingUrl,
} from '@resget/shared';
import type {
  AddressSnapshot,
  CreateOrderInput,
  GeoPoint,
  OrderActor,
  OrderDetailDTO,
  OrderStatusValue,
  OrderSummaryDTO,
  OrderTrackingDTO,
  OrderTransitionInput,
  OrdersQuery,
  SettlementLine,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService, courierTopic, dispatchTopic, orderTopic } from '../realtime/realtime.service';
import type { TopicEvent } from '../realtime/realtime.service';
import { badRequest, conflict, notFound } from '../../common/api-error';

export const ACTIVE_TRIP_STATUSES = ['PLANNED', 'ASSIGNED', 'IN_PROGRESS'] as const;
export const ACTIVE_STOP_STATUSES = ['PENDING', 'EN_ROUTE', 'ARRIVING'] as const;

const orderArgs = Prisma.validator<Prisma.OrderDefaultArgs>()({
  include: {
    table: { select: { label: true } },
    customer: { select: { id: true, fullName: true, phone: true } },
    items: { orderBy: { position: 'asc' } },
    statusHistory: { orderBy: { createdAt: 'asc' } },
    deliveryStops: {
      where: { status: { in: [...ACTIVE_STOP_STATUSES] }, trip: { status: { in: [...ACTIVE_TRIP_STATUSES] } } },
      include: { trip: { select: { id: true, status: true, courierMembershipId: true } } },
      take: 1,
    },
  },
});
export type OrderRow = Prisma.OrderGetPayload<typeof orderArgs>;

type Db = Prisma.TransactionClient | PrismaService;

export interface TransitionOptions {
  reason?: string;
  prepMinutes?: number;
  /** Set by the dispatch service, which may move an order that sits in an active trip. */
  fromTrip?: boolean;
}

/**
 * Orders: creation with the settlement snapshot, the status machine with
 * its history, and the read models of the restaurant screens and the
 * customer's tracking page. Every change ends in realtime events for the
 * restaurant, the courier (when a trip is involved) and the customer.
 */
@Injectable()
export class OrdersService {
  /** Registered by the dispatch service so a cancelled order can refresh its trip without a circular import. */
  private tripEvents: ((tripId: string) => Promise<TopicEvent[]>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
  ) {}

  setTripEventsProvider(provider: (tripId: string) => Promise<TopicEvent[]>): void {
    this.tripEvents = provider;
  }

  // -- Creation ------------------------------------------------------------------

  async create(
    restaurantId: string,
    input: CreateOrderInput,
    actorUserId: string | null,
    canSeeContacts: boolean,
  ): Promise<OrderDetailDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        currency: true,
        countryCode: true,
        commissionBps: true,
        pspPercentBps: true,
        pspFixedMinor: true,
        paymentMode: true,
        deliveryMode: true,
      },
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    const branch = await this.prisma.branch.findFirst({
      where: { id: input.branchId, restaurantId, isActive: true },
      select: { id: true },
    });
    if (!branch) throw notFound('NOT_FOUND', 'Branch not found');
    if (input.tableId) {
      const table = await this.prisma.diningTable.findFirst({
        where: { id: input.tableId, restaurantId, branchId: input.branchId, isActive: true },
        select: { id: true },
      });
      if (!table) throw notFound('TABLE_NOT_FOUND', 'Table not found');
    }

    const menuItems = await this.prisma.menuItem.findMany({
      where: { restaurantId, id: { in: input.items.map((line) => line.menuItemId) } },
      select: { id: true, name: true, priceMinor: true, vatRateBps: true, isAvailable: true, currency: true },
    });
    const byId = new Map(menuItems.map((item) => [item.id, item]));
    const lines = input.items.map((line, position) => {
      const item = byId.get(line.menuItemId);
      if (!item) throw notFound('NOT_FOUND', `Menu item ${line.menuItemId} not found`);
      if (!item.isAvailable) throw conflict('MENU_ITEM_UNAVAILABLE', `${item.name} is not available`);
      if (item.currency !== restaurant.currency) throw badRequest('VALIDATION', 'Menu item currency mismatch');
      const modifiersDelta = line.modifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0);
      const unitPriceMinor = item.priceMinor + modifiersDelta;
      if (unitPriceMinor < 0) throw badRequest('VALIDATION', 'Negative line price');
      return {
        menuItemId: item.id,
        nameSnapshot: item.name,
        unitPriceMinor,
        quantity: line.quantity,
        vatRateBps: item.vatRateBps,
        modifiersSnapshot: line.modifiers,
        lineTotalMinor: unitPriceMinor * line.quantity,
        position,
      };
    });

    const regional = settlementDefaultsFor(restaurant.countryCode);
    const isDelivery = input.fulfillment === 'DELIVERY';
    const deliveryFee: SettlementLine | null =
      isDelivery && input.deliveryFeeMinor > 0
        ? { amountMinor: input.deliveryFeeMinor, vatRateBps: deliveryFeeVatBpsFor(restaurant.countryCode) }
        : null;
    const settlement = computeModeSettlement(restaurant.paymentMode, {
      currency: restaurant.currency,
      items: lines.map((l) => ({ amountMinor: l.lineTotalMinor, vatRateBps: l.vatRateBps })),
      deliveryFee,
      commissionBps: restaurant.commissionBps,
      commissionVatBps: regional.commissionVatBps,
      psp: { percentBps: restaurant.pspPercentBps, fixedMinor: restaurant.pspFixedMinor, bearer: 'RESTAURANT' },
      withholdingBps: regional.withholdingBps,
    });

    const contact =
      input.customer ??
      (input.address ? { phone: input.address.contactPhone, fullName: input.address.contactName } : null);

    const orderId = await this.prisma.$transaction(async (tx) => {
      let customerUserId: string | null = null;
      if (contact) {
        const user = await tx.user.upsert({
          where: { phone: contact.phone },
          update: {},
          create: { phone: contact.phone, fullName: contact.fullName },
          select: { id: true },
        });
        customerUserId = user.id;
        await tx.restaurantCustomer.upsert({
          where: { restaurantId_userId: { restaurantId, userId: user.id } },
          update: {
            orderCount: { increment: 1 },
            lastOrderAt: new Date(),
            lifetimeGrossMinor: { increment: settlement.itemsGrossMinor },
          },
          create: {
            restaurantId,
            userId: user.id,
            firstChannel: input.channel,
            firstOrderAt: new Date(),
            lastOrderAt: new Date(),
            orderCount: 1,
            lifetimeGrossMinor: settlement.itemsGrossMinor,
          },
        });
      }
      const created = await tx.order.create({
        data: {
          restaurantId,
          branchId: input.branchId,
          customerUserId,
          tableId: input.tableId ?? null,
          channel: input.channel,
          fulfillment: input.fulfillment,
          deliveryMode: isDelivery
            ? restaurant.deliveryMode === 'NONE'
              ? 'RESTAURANT_COURIER'
              : restaurant.deliveryMode
            : 'NONE',
          status: 'PLACED',
          currency: restaurant.currency,
          itemsGrossMinor: settlement.itemsGrossMinor,
          itemsVatMinor: settlement.itemsVatMinor,
          deliveryFeeMinor: settlement.deliveryFeeMinor,
          discountMinor: settlement.discountMinor,
          discountFundedBy: settlement.discountFundedBy,
          chargedToCustomerMinor: settlement.chargedToCustomerMinor,
          commissionBps: restaurant.commissionBps,
          platformCommissionMinor: settlement.platformCommissionMinor,
          commissionVatMinor: settlement.commissionVatMinor,
          pspFeeMinor: settlement.pspFeeMinor,
          pspFeeBearer: settlement.pspFeeBearer,
          withholdingMinor: settlement.withholdingMinor,
          courierCostMinor: settlement.courierCostMinor,
          courierBearer: settlement.courierBearer,
          restaurantPayableMinor: settlement.restaurantPayableMinor,
          paymentMode: restaurant.paymentMode,
          platformReceivableMinor: settlement.platformReceivableMinor,
          addressSnapshot: input.address ? (input.address as Prisma.InputJsonValue) : Prisma.JsonNull,
          customerNote: input.note ?? null,
          trackingToken: randomBytes(TRACKING_TOKEN_BYTES).toString('base64url'),
          items: {
            create: lines.map((l) => ({ ...l, modifiersSnapshot: l.modifiersSnapshot as Prisma.InputJsonValue })),
          },
          statusHistory: { create: { fromStatus: null, toStatus: 'PLACED', actorUserId } },
        },
        select: { id: true },
      });
      if (input.qrSessionId) {
        await tx.qrScanEvent.create({
          data: {
            restaurantId,
            tableId: input.tableId ?? null,
            sessionId: input.qrSessionId,
            outcome: 'PLACED_ORDER',
            userId: customerUserId,
            orderId: created.id,
          },
        });
      }
      return created.id;
    });

    this.realtime.publishMany(await this.eventsForOrder(orderId));
    return this.detail(restaurantId, orderId, canSeeContacts);
  }

  // -- Reads ----------------------------------------------------------------------

  async list(restaurantId: string, query: OrdersQuery, canSeeContacts: boolean): Promise<OrderSummaryDTO[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        restaurantId,
        ...(query.status ? { status: { in: query.status } } : {}),
        ...(query.fulfillment ? { fulfillment: query.fulfillment } : {}),
        ...(query.active
          ? {
              status: {
                notIn: [
                  'DELIVERED',
                  'PICKED_UP',
                  'CANCELLED_BY_CUSTOMER',
                  'CANCELLED_BY_RESTAURANT',
                  'REJECTED',
                  'REFUNDED',
                ],
              },
            }
          : {}),
      },
      orderBy: { placedAt: 'desc' },
      take: query.limit,
      ...orderArgs,
    });
    return rows.map((row) => this.toSummary(row, canSeeContacts));
  }

  async detail(restaurantId: string, orderId: string, canSeeContacts: boolean): Promise<OrderDetailDTO> {
    const row = await this.prisma.order.findFirst({ where: { id: orderId, restaurantId }, ...orderArgs });
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    return this.toDetail(row, canSeeContacts);
  }

  async loadRow(db: Db, orderId: string): Promise<OrderRow> {
    const row = await db.order.findUnique({ where: { id: orderId }, ...orderArgs });
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    return row;
  }

  // -- Transitions ------------------------------------------------------------------

  /** HTTP entry point for restaurant staff: the trip owns the courier leg of an order that rides in one. */
  async transition(
    restaurantId: string,
    orderId: string,
    input: OrderTransitionInput,
    actor: OrderActor,
    actorUserId: string | null,
    canSeeContacts: boolean,
  ): Promise<OrderDetailDTO> {
    const row = await this.prisma.order.findFirst({ where: { id: orderId, restaurantId }, ...orderArgs });
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    const activeStop = row.deliveryStops[0];
    const touchesCourierLeg = COURIER_LEG_STATUSES.includes(input.to) || input.to === 'READY';
    if (activeStop && touchesCourierLeg) {
      throw conflict('ORDER_IN_TRIP', 'The order rides in a trip; use the trip endpoints');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.applyTransition(tx, row, input.to, actor, actorUserId, {
        reason: input.reason,
        prepMinutes: input.prepMinutes,
      });
      if (activeStop && isTerminalOrderStatus(input.to)) {
        // A cancelled order leaves its trip; the trip itself goes on with the other stops.
        await tx.deliveryStop.update({ where: { id: activeStop.id }, data: { status: 'REMOVED' } });
      }
    });
    const events = await this.eventsForOrder(orderId);
    if (activeStop && this.tripEvents) events.push(...(await this.tripEvents(activeStop.tripId)));
    this.realtime.publishMany(events);
    return this.detail(restaurantId, orderId, canSeeContacts);
  }

  /**
   * Applies one transition inside a transaction: validates it against the
   * state machine, stamps the timestamps, writes the history line. Callers
   * publish events after their transaction commits (eventsForOrder).
   */
  async applyTransition(
    tx: Prisma.TransactionClient,
    order: Pick<OrderRow, 'id' | 'status' | 'fulfillment' | 'placedAt'>,
    to: OrderStatusValue,
    actor: OrderActor,
    actorUserId: string | null,
    options: TransitionOptions = {},
  ): Promise<void> {
    if (!canTransitionOrder(order.fulfillment, order.status, to, actor)) {
      throw conflict(
        'ORDER_TRANSITION_INVALID',
        `${order.fulfillment} order cannot go ${order.status} -> ${to} as ${actor}`,
      );
    }
    const now = new Date();
    const data: Prisma.OrderUpdateInput = { status: to };
    const stamp = orderTimestampFor(to);
    if (stamp) data[stamp] = now;
    if (to === 'ACCEPTED') {
      const minutes = options.prepMinutes ?? (await this.defaultPrepMinutes(tx, order.id));
      data.promisedReadyAt = new Date(now.getTime() + minutes * 60_000);
    }
    if (to === 'REJECTED' || to === 'CANCELLED_BY_RESTAURANT' || to === 'CANCELLED_BY_CUSTOMER') {
      data.rejectReason = options.reason ?? null;
    }
    if (to === 'DELIVERED' || to === 'PICKED_UP') data.estimatedDeliveryAt = null;
    await tx.order.update({ where: { id: order.id }, data });
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: order.status, toStatus: to, actorUserId, reason: options.reason ?? null },
    });
    order.status = to;
  }

  private async defaultPrepMinutes(tx: Prisma.TransactionClient, orderId: string): Promise<number> {
    const row = await tx.order.findUnique({
      where: { id: orderId },
      select: { restaurant: { select: { dispatchSettings: true } } },
    });
    return dispatchSettingsFrom(row?.restaurant.dispatchSettings).defaultPrepMinutes;
  }

  // -- Events -------------------------------------------------------------------------

  /** The realtime events that describe the current state of an order, for every audience. */
  async eventsForOrder(orderId: string): Promise<TopicEvent[]> {
    const row = await this.prisma.order.findUnique({ where: { id: orderId }, ...orderArgs });
    if (!row) return [];
    const events: TopicEvent[] = [
      { topic: dispatchTopic(row.restaurantId), event: { type: 'order.updated', order: this.toSummary(row, true) } },
      { topic: orderTopic(row.id), event: { type: 'tracking.updated', tracking: await this.trackingOf(row) } },
    ];
    const courierMembershipId = row.deliveryStops[0]?.trip.courierMembershipId;
    if (courierMembershipId) {
      events.push({
        topic: courierTopic(courierMembershipId),
        event: { type: 'order.updated', order: this.toSummary(row, true) },
      });
    }
    return events;
  }

  // -- Tracking -----------------------------------------------------------------------

  async trackingByToken(token: string): Promise<OrderTrackingDTO & { orderId: string }> {
    const row = await this.prisma.order.findUnique({ where: { trackingToken: token }, ...orderArgs });
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    return this.trackingOf(row);
  }

  async trackingOf(row: OrderRow): Promise<OrderTrackingDTO> {
    const [restaurant, branch] = await Promise.all([
      this.prisma.restaurant.findUnique({
        where: { id: row.restaurantId },
        select: { name: true, logoUrl: true, themePrimary: true },
      }),
      this.prisma.branch.findUnique({ where: { id: row.branchId }, select: { phone: true } }),
    ]);
    const address = this.addressOf(row);
    const destination = address?.point ?? null;
    const stop = row.deliveryStops[0];
    let courier: OrderTrackingDTO['courier'] = null;
    if (
      stop &&
      stop.trip.courierMembershipId &&
      COURIER_LEG_STATUSES.includes(row.status) &&
      row.status !== 'DELIVERED'
    ) {
      const membership = await this.prisma.membership.findUnique({
        where: { id: stop.trip.courierMembershipId },
        select: { user: { select: { fullName: true } }, courierLocation: true },
      });
      const location = stop.trip.status === 'IN_PROGRESS' ? (membership?.courierLocation ?? null) : null;
      const position = location
        ? {
            lat: location.lat,
            lng: location.lng,
            headingDeg: location.headingDeg,
            speedMps: location.speedMps,
            accuracyM: location.accuracyM,
            recordedAt: location.recordedAt.toISOString(),
          }
        : null;
      const stopsAhead = await this.prisma.deliveryStop.count({
        where: { tripId: stop.tripId, status: { in: [...ACTIVE_STOP_STATUSES] }, sequence: { lt: stop.sequence } },
      });
      courier = {
        firstName: membership ? courierDisplayName(membership.user.fullName) : '',
        position,
        distanceMeters: position && destination ? Math.round(haversineMeters(position, destination)) : null,
        stopsAhead,
      };
    }
    return {
      orderId: row.id,
      shortCode: orderShortCode(row.id),
      status: row.status,
      fulfillment: row.fulfillment,
      restaurant: {
        name: restaurant?.name ?? '',
        logoUrl: restaurant?.logoUrl ?? null,
        themePrimary: restaurant?.themePrimary ?? '#0092CD',
        phone: branch?.phone ?? null,
      },
      items: row.items.map((item) => ({ name: item.nameSnapshot, quantity: item.quantity })),
      placedAt: row.placedAt.toISOString(),
      promisedReadyAt: row.promisedReadyAt?.toISOString() ?? null,
      estimatedDeliveryAt: row.estimatedDeliveryAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      history: row.statusHistory.map((h) => ({
        from: h.fromStatus,
        to: h.toStatus,
        reason: h.reason,
        at: h.createdAt.toISOString(),
      })),
      courier,
      destination,
    };
  }

  // -- Mapping ------------------------------------------------------------------------

  addressOf(row: Pick<OrderRow, 'addressSnapshot'>): AddressSnapshot | null {
    const raw = row.addressSnapshot;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const snapshot = raw as unknown as AddressSnapshot;
    const point = snapshot.point;
    const safePoint: GeoPoint | null =
      point && typeof point.lat === 'number' && typeof point.lng === 'number'
        ? { lat: point.lat, lng: point.lng }
        : null;
    return { ...snapshot, point: safePoint };
  }

  toSummary(row: OrderRow, canSeeContacts: boolean): OrderSummaryDTO {
    const address = this.addressOf(row);
    const stop = row.deliveryStops[0];
    const phone = row.customer?.phone ?? address?.contactPhone ?? null;
    return {
      id: row.id,
      shortCode: orderShortCode(row.id),
      restaurantId: row.restaurantId,
      branchId: row.branchId,
      channel: row.channel,
      fulfillment: row.fulfillment,
      status: row.status,
      currency: row.currency,
      chargedToCustomerMinor: row.chargedToCustomerMinor,
      itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
      tableLabel: row.table?.label ?? null,
      customer: {
        userId: row.customer?.id ?? null,
        fullName: row.customer?.fullName ?? address?.contactName ?? null,
        phone: phone ? (canSeeContacts ? phone : maskPhoneForDisplay(phone)) : null,
      },
      address: address
        ? canSeeContacts
          ? address
          : { ...address, contactPhone: maskPhoneForDisplay(address.contactPhone) }
        : null,
      note: row.customerNote,
      placedAt: row.placedAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      promisedReadyAt: row.promisedReadyAt?.toISOString() ?? null,
      readyAt: row.readyAt?.toISOString() ?? null,
      estimatedDeliveryAt: row.estimatedDeliveryAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      activeTrip: stop
        ? { tripId: stop.tripId, stopId: stop.id, sequence: stop.sequence, tripStatus: stop.trip.status }
        : null,
    };
  }

  toDetail(row: OrderRow, canSeeContacts: boolean): OrderDetailDTO {
    return {
      ...this.toSummary(row, canSeeContacts),
      items: row.items.map((item) => ({
        id: item.id,
        name: item.nameSnapshot,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        lineTotalMinor: item.lineTotalMinor,
        modifiers: Array.isArray(item.modifiersSnapshot)
          ? (item.modifiersSnapshot as unknown as { name: string; priceDeltaMinor: number }[])
          : [],
      })),
      history: row.statusHistory.map((h) => ({
        from: h.fromStatus,
        to: h.toStatus,
        reason: h.reason,
        at: h.createdAt.toISOString(),
      })),
      trackingUrl: trackingUrl(this.config.getOrThrow<string>('PUBLIC_APP_URL'), row.trackingToken ?? ''),
      itemsGrossMinor: row.itemsGrossMinor,
      deliveryFeeMinor: row.deliveryFeeMinor,
      discountMinor: row.discountMinor,
      restaurantPayableMinor: row.restaurantPayableMinor,
      platformReceivableMinor: row.platformReceivableMinor,
    };
  }
}
