import { Injectable, Logger } from '@nestjs/common';
import {
  CANCELLABLE_DELIVERY_REQUEST_STATUSES,
  COURIER_CALLABLE_ORDER_STATUSES,
  isActiveDeliveryRequest,
  networkOrderSteps,
  nextDeliveryRequestStatus,
} from '@resget/shared';
import type {
  CourierDispatch,
  CourierEvent,
  CourierNetworkStatusDTO,
  CourierProviderAdapter,
  CourierQuote,
  OrderDetailDTO,
  OrderStatusValue,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { OrdersService } from '../orders/orders.service';
import { OrderNotificationsService } from '../orders/order-notifications.service';
import { CourierRegistry } from '../courier/courier.registry';
import { LedgerService } from '../ledger/ledger.service';
import { badRequest, conflict, forbidden, notFound } from '../../common/api-error';

/** Order statuses whose active network delivery is called off with them. */
const CANCELLING_STATUSES: readonly string[] = ['REJECTED', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_CUSTOMER'];

export interface CourierWebhookOutcome {
  received: true;
  status: string;
}

/**
 * Calling a courier network for one order (docs/KURYE.md, "Kurye çağırma"):
 * quote and dispatch through the restaurant's network, the network's signed
 * events moving the request and the order, and cancellation by the
 * restaurant or with the order.
 */
@Injectable()
export class CourierRequestsService {
  private readonly logger = new Logger(CourierRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly features: FeatureFlagsService,
    private readonly orders: OrdersService,
    private readonly notifications: OrderNotificationsService,
    private readonly registry: CourierRegistry,
    private readonly ledger: LedgerService,
  ) {
    this.orders.addOrderListener((order) => this.onOrderChanged(order));
  }

  /** Whether the order screen offers a courier call: the module, an active network and its adapter. */
  async networkStatus(restaurantId: string): Promise<CourierNetworkStatusDTO> {
    const network = await this.networkOf(restaurantId);
    return network ? { available: true, providerName: network.name } : { available: false, providerName: null };
  }

  private async networkOf(
    restaurantId: string,
  ): Promise<{ id: string; name: string; adapter: CourierProviderAdapter } | null> {
    if (!(await this.features.isEnabled('courier_network', restaurantId))) return null;
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { courierProvider: { select: { id: true, code: true, name: true, isActive: true } } },
    });
    const provider = restaurant?.courierProvider;
    const adapter = provider?.isActive ? this.registry.get(provider.code) : null;
    return provider && adapter ? { id: provider.id, name: provider.name, adapter } : null;
  }

  // -- The restaurant's actions -----------------------------------------------------------

  async call(
    restaurantId: string,
    orderId: string,
    actorUserId: string,
    canSeeContacts: boolean,
  ): Promise<OrderDetailDTO> {
    const row = await this.orders.loadRow(this.prisma, orderId);
    if (row.restaurantId !== restaurantId) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    if (row.fulfillment !== 'DELIVERY' || !COURIER_CALLABLE_ORDER_STATUSES.includes(row.status)) {
      throw conflict('COURIER_REQUEST_NOT_ALLOWED', `A ${row.fulfillment} ${row.status} order takes no courier`);
    }
    if (row.deliveryStops[0]) throw conflict('COURIER_REQUEST_NOT_ALLOWED', "The order rides in an own courier's trip");
    if (row.deliveryRequest && isActiveDeliveryRequest(row.deliveryRequest.status)) {
      throw conflict('COURIER_REQUEST_NOT_ALLOWED', 'A courier is already called');
    }
    const network = await this.networkOf(restaurantId);
    if (!network) throw conflict('COURIER_REQUEST_NOT_ALLOWED', 'No active courier network');
    const address = this.orders.addressOf(row);
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: row.branchId },
      select: { addressLine: true, lat: true, lng: true, phone: true, restaurant: { select: { name: true } } },
    });
    if (!address?.point || branch.lat === null || branch.lng === null) {
      throw conflict('COURIER_REQUEST_NOT_ALLOWED', 'Pickup and drop-off need a location');
    }

    let quote: CourierQuote;
    try {
      quote = await network.adapter.quote({
        restaurantId,
        pickup: {
          address: branch.addressLine,
          point: { lat: branch.lat, lng: branch.lng },
          contactName: branch.restaurant.name,
          contactPhone: branch.phone ?? '',
        },
        dropoff: {
          address: address.addressLine,
          point: address.point,
          contactName: address.contactName,
          contactPhone: address.contactPhone,
          ...(address.note ? { note: address.note } : {}),
        },
        parcelValueMinor: row.chargedToCustomerMinor,
        currency: row.currency,
        ...(row.promisedReadyAt && row.promisedReadyAt > new Date()
          ? { readyAt: row.promisedReadyAt.toISOString() }
          : {}),
      });
    } catch (err) {
      this.logger.warn(`Courier quote failed (${network.adapter.code}): ${(err as Error).message}`);
      throw forbidden('COURIER_QUOTE_FAILED', 'Courier network did not return a quote');
    }
    let dispatched: CourierDispatch;
    try {
      dispatched = await network.adapter.dispatch(quote.quoteId, row.id);
    } catch (err) {
      this.logger.warn(`Courier dispatch failed (${network.adapter.code}): ${(err as Error).message}`);
      throw conflict('COURIER_DISPATCH_FAILED', 'Courier network did not accept the call');
    }

    const data = {
      providerId: network.id,
      status: 'REQUESTED' as const,
      quoteId: quote.quoteId,
      quoteFeeMinor: quote.feeMinor,
      finalFeeMinor: null,
      currency: quote.currency,
      providerRef: dispatched.providerRef,
      trackingUrl: dispatched.trackingUrl,
      pickupEtaMinutes: quote.pickupEtaMinutes,
      dropoffEtaMinutes: quote.dropoffEtaMinutes,
      failureReason: null,
    };
    // A cancelled or failed request is replaced in place: one request per order.
    await this.prisma.$transaction([
      this.prisma.deliveryRequest.upsert({
        where: { orderId: row.id },
        create: { restaurantId, orderId: row.id, ...data },
        update: data,
      }),
      this.prisma.auditLog.create({
        data: {
          restaurantId,
          actorUserId,
          action: 'courier.called',
          entity: 'Order',
          entityId: row.id,
          meta: { provider: network.adapter.code, quoteFeeMinor: quote.feeMinor },
        },
      }),
    ]);
    await this.publish(row.id);
    return this.orders.detail(restaurantId, row.id, canSeeContacts);
  }

  /** Calls the courier off before the parcel is picked up. */
  async cancel(
    restaurantId: string,
    orderId: string,
    actorUserId: string,
    canSeeContacts: boolean,
  ): Promise<OrderDetailDTO> {
    const request = await this.prisma.deliveryRequest.findFirst({
      where: { orderId, restaurantId },
      include: { provider: { select: { code: true } } },
    });
    if (!request || !CANCELLABLE_DELIVERY_REQUEST_STATUSES.includes(request.status)) {
      throw conflict('COURIER_REQUEST_NOT_ALLOWED', 'No courier call to cancel');
    }
    const adapter = this.registry.get(request.provider.code);
    try {
      if (request.providerRef && adapter) await adapter.cancel(request.providerRef);
    } catch (err) {
      this.logger.warn(`Courier cancel failed (${request.provider.code}): ${(err as Error).message}`);
      throw conflict('COURIER_DISPATCH_FAILED', 'Courier network did not accept the cancellation');
    }
    await this.apply(request.id, request.status, { kind: 'CANCELLED', reason: 'cancelled by the restaurant' });
    await this.prisma.auditLog.create({
      data: { restaurantId, actorUserId, action: 'courier.cancelled', entity: 'Order', entityId: orderId },
    });
    return this.orders.detail(restaurantId, orderId, canSeeContacts);
  }

  // -- The network's notifications ---------------------------------------------------------

  async handleWebhook(
    providerCode: string,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<CourierWebhookOutcome> {
    const adapter = this.registry.get(providerCode);
    let event: CourierEvent;
    try {
      if (!adapter) throw new Error('Unknown courier network');
      event = adapter.parseWebhook(rawBody, headers);
    } catch (err) {
      this.logger.warn(`Courier webhook rejected (${providerCode}): ${(err as Error).message}`);
      throw badRequest('WEBHOOK_INVALID', 'Webhook could not be verified');
    }
    const request = await this.prisma.deliveryRequest.findFirst({
      where: { providerRef: event.providerRef, provider: { code: providerCode } },
      select: { id: true, status: true },
    });
    if (!request) return { received: true, status: 'IGNORED' };
    const moved = await this.apply(request.id, request.status, event);
    return { received: true, status: moved ? event.kind : 'IGNORED' };
  }

  /**
   * Moves a request by one event and walks its order along, in one
   * transaction; a concurrent event that moved the request first wins.
   */
  private async apply(
    requestId: string,
    current: Parameters<typeof nextDeliveryRequestStatus>[0],
    event: Pick<CourierEvent, 'kind' | 'reason' | 'finalFeeMinor'>,
  ): Promise<boolean> {
    const next = nextDeliveryRequestStatus(current, event.kind);
    if (!next) return false;
    const steps: OrderStatusValue[] = [];
    const orderId = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.deliveryRequest.updateMany({
        where: { id: requestId, status: current },
        data: {
          status: next,
          ...(event.kind === 'DELIVERED' && event.finalFeeMinor !== undefined
            ? { finalFeeMinor: event.finalFeeMinor }
            : {}),
          ...(event.kind === 'CANCELLED' || event.kind === 'FAILED'
            ? { failureReason: event.reason ?? event.kind.toLowerCase() }
            : {}),
        },
      });
      if (count === 0) return null;
      const request = await tx.deliveryRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: { orderId: true },
      });
      let row = await this.orders.loadRow(tx, request.orderId);
      for (const step of networkOrderSteps(row.status, event.kind)) {
        await this.orders.applyTransition(tx, row, step.to, step.actor, null, {
          reason: `courier network: ${event.kind.toLowerCase()}`,
        });
        row = { ...row, status: step.to };
        steps.push(step.to);
      }
      // The network's final fee corrects what the payout took for the courier; this transaction marks the
      // request DELIVERED, so it happens once (docs/KURYE.md, "Yaşam döngüsü"). The order is completed by now.
      if (event.kind === 'DELIVERED' && event.finalFeeMinor !== undefined) {
        await this.ledger.recordCourierFeeAdjustment(tx, request.orderId, event.finalFeeMinor);
      }
      return request.orderId;
    });
    if (!orderId) return false;
    await this.publish(orderId);
    for (const status of steps) await this.notifications.notify(orderId, status);
    return true;
  }

  /** A rejected or cancelled order calls its courier off; the network may still refuse, which is logged. */
  private async onOrderChanged(order: { id: string; restaurantId: string; status: string }): Promise<void> {
    if (!CANCELLING_STATUSES.includes(order.status)) return;
    const request = await this.prisma.deliveryRequest.findUnique({
      where: { orderId: order.id },
      include: { provider: { select: { code: true } } },
    });
    if (!request || !CANCELLABLE_DELIVERY_REQUEST_STATUSES.includes(request.status)) return;
    try {
      const adapter = this.registry.get(request.provider.code);
      if (request.providerRef && adapter) await adapter.cancel(request.providerRef);
    } catch (err) {
      this.logger.warn(`Courier call for cancelled order ${order.id} not cancelled: ${(err as Error).message}`);
      return;
    }
    await this.apply(request.id, request.status, { kind: 'CANCELLED', reason: 'order cancelled' });
  }

  private async publish(orderId: string): Promise<void> {
    this.realtime.publishMany(await this.orders.eventsForOrder(orderId));
  }
}
