import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@resget/database';
import type { CourierTip, CourierTipStatus } from '@resget/database';
import {
  LedgerEntryType,
  courierDisplayName,
  formatMoney,
  orderShortCode,
  tipLimits,
  tipNetMinor,
  tipPresets,
  withinTipWindow,
} from '@resget/shared';
import type {
  CourierTipsRowDTO,
  GatewayWebhookEvent,
  NetworkTipsRowDTO,
  OrderTrackingDTO,
  StartTipInput,
  TipDTO,
  TipStartedDTO,
  TipTotalsDTO,
  TipsReportDTO,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { OrdersService } from '../orders/orders.service';
import type { OrderRow } from '../orders/orders.service';
import { CheckoutService } from '../payments/checkout.service';
import type { WebhookScope } from '../payments/checkout.service';
import { MealCardsService } from '../payments/meal-cards.service';
import { CourierRegistry } from '../courier/courier.registry';
import { PushService } from '../push/push.service';
import { badRequest, conflict, notFound } from '../../common/api-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A tip in one of these states is settled: no second tip for the order. */
const SETTLED: readonly CourierTipStatus[] = ['CAPTURED', 'REFUNDED', 'CHARGED_BACK'];
const RESTARTABLE: CourierTipStatus[] = ['PENDING', 'FAILED'];
const REPORT_ROW_CAP = 5000;
const RECENT_LIMIT = 50;

/** Who receives the tip: the restaurant's own courier or a courier network that takes tips. */
type Recipient =
  | { kind: 'OWN'; membershipId: string; userId: string; name: string; tripId: string }
  | { kind: 'NETWORK'; deliveryRequestId: string; name: string };

interface TipOrder {
  id: string;
  restaurantId: string;
  status: string;
  fulfillment: string;
  completedAt: Date | null;
  chargedToCustomerMinor: number;
  currency: string;
}

/**
 * Courier tips (docs/BAHSIS.md). A tip lives in its own table so it never
 * counts toward the order's payments, refunds or commission. It is
 * collected by whoever collects the restaurant's online payments, and only
 * that provider's fee comes off it.
 */
@Injectable()
export class TipsService {
  private readonly logger = new Logger(TipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly features: FeatureFlagsService,
    private readonly orders: OrdersService,
    private readonly checkout: CheckoutService,
    private readonly mealCards: MealCardsService,
    private readonly couriers: CourierRegistry,
    private readonly push: PushService,
  ) {
    this.orders.setTrackingTipExtender((row) => this.trackingExtras(row));
    this.checkout.setTipWebhookHandler((event, scope) => this.handleWebhook(event, scope));
  }

  // -- Tracking page ------------------------------------------------------------------

  async trackingExtras(row: OrderRow): Promise<Pick<OrderTrackingDTO, 'tip' | 'tipOffer'>> {
    const existing = await this.prisma.courierTip.findUnique({ where: { orderId: row.id } });
    const tip = existing
      ? { status: existing.status, amountMinor: existing.amountMinor, currency: existing.currency }
      : null;
    if (existing && SETTLED.includes(existing.status)) return { tip, tipOffer: null };
    const recipient = await this.eligibleRecipient(row);
    if (!recipient) return { tip, tipOffer: null };
    const { minMinor, maxMinor } = tipLimits(row.chargedToCustomerMinor, row.currency);
    return {
      tip,
      tipOffer: {
        currency: row.currency,
        presetsMinor: tipPresets(row.chargedToCustomerMinor, row.currency),
        minMinor,
        maxMinor,
        recipient: recipient.name,
      },
    };
  }

  /** The courier a tip can reach, or null when the order cannot be tipped now. */
  private async eligibleRecipient(order: TipOrder): Promise<Recipient | null> {
    if (order.fulfillment !== 'DELIVERY' || order.status !== 'DELIVERED') return null;
    if (!withinTipWindow(order.completedAt)) return null;
    const { minMinor, maxMinor } = tipLimits(order.chargedToCustomerMinor, order.currency);
    if (maxMinor < minMinor) return null;
    if (!(await this.features.isEnabled('courier_tips', order.restaurantId))) return null;
    // Collected like the order's online payment; without a way to take a card there is no tip.
    if (!(await this.mealCards.acceptedMethods(order.restaurantId)).onlineCard) return null;
    return this.recipientOf(order.id);
  }

  private async recipientOf(orderId: string): Promise<Recipient | null> {
    const stop = await this.prisma.deliveryStop.findFirst({
      where: { orderId, status: 'DELIVERED' },
      orderBy: { deliveredAt: 'desc' },
      select: {
        tripId: true,
        trip: { select: { courier: { select: { id: true, userId: true, user: { select: { fullName: true } } } } } },
      },
    });
    const courier = stop?.trip.courier;
    if (stop && courier) {
      return {
        kind: 'OWN',
        membershipId: courier.id,
        userId: courier.userId,
        name: courierDisplayName(courier.user.fullName),
        tripId: stop.tripId,
      };
    }
    const request = await this.prisma.deliveryRequest.findUnique({
      where: { orderId },
      select: { id: true, status: true, providerRef: true, provider: { select: { code: true, name: true } } },
    });
    if (!request || request.status !== 'DELIVERED' || !request.providerRef) return null;
    // A network that cannot hand a tip on is never offered one: the customer's money must reach a courier.
    const adapter = this.couriers.get(request.provider.code);
    if (!adapter?.supportsTips || !adapter.addTip) return null;
    return { kind: 'NETWORK', deliveryRequestId: request.id, name: request.provider.name };
  }

  // -- Starting a tip -------------------------------------------------------------------

  async start(trackingToken: string, input: StartTipInput, customerIp?: string): Promise<TipStartedDTO> {
    const order = await this.prisma.order.findUnique({
      where: { trackingToken },
      select: {
        id: true,
        restaurantId: true,
        status: true,
        fulfillment: true,
        completedAt: true,
        chargedToCustomerMinor: true,
        currency: true,
        customer: { select: { phone: true, fullName: true } },
        restaurant: { select: { paymentMode: true, paymentConnection: { select: { providerCode: true } } } },
      },
    });
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    const existing = await this.prisma.courierTip.findUnique({ where: { orderId: order.id } });
    if (existing && SETTLED.includes(existing.status)) throw conflict('TIP_ALREADY_PAID', 'This order has a tip');
    const recipient = await this.eligibleRecipient(order);
    if (!recipient) throw conflict('TIP_UNAVAILABLE', 'This order cannot be tipped');
    const { minMinor, maxMinor } = tipLimits(order.chargedToCustomerMinor, order.currency);
    if (input.amountMinor < minMinor || input.amountMinor > maxMinor) {
      throw badRequest('TIP_AMOUNT_INVALID', `A tip is between ${minMinor} and ${maxMinor}`);
    }

    const fields = {
      amountMinor: input.amountMinor,
      currency: order.currency,
      courierMembershipId: recipient.kind === 'OWN' ? recipient.membershipId : null,
      deliveryRequestId: recipient.kind === 'NETWORK' ? recipient.deliveryRequestId : null,
    };
    let tipId: string;
    if (existing) {
      // An abandoned or failed attempt starts again; a capture that lands meanwhile wins.
      const { count } = await this.prisma.courierTip.updateMany({
        where: { id: existing.id, status: { in: RESTARTABLE } },
        data: { ...fields, status: 'PENDING' },
      });
      if (count === 0) throw conflict('TIP_ALREADY_PAID', 'This order has a tip');
      tipId = existing.id;
    } else {
      const created = await this.prisma.courierTip
        .create({
          data: {
            restaurantId: order.restaurantId,
            orderId: order.id,
            ...fields,
            paymentMode: order.restaurant.paymentMode,
            provider:
              order.restaurant.paymentMode === 'OWN_POS'
                ? (order.restaurant.paymentConnection?.providerCode ?? 'POS')
                : this.checkout.platformProviderCode(),
          },
        })
        .catch((err: unknown) => {
          // Two starts at once: the other one owns the attempt.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
          throw err;
        });
      if (!created) throw conflict('TIP_UNAVAILABLE', 'A tip for this order is being started');
      tipId = created.id;
    }

    // The provider sees the tip's own id as the order reference, so its notification finds the tip.
    const opened = await this.checkout.openHostedCheckout(order.restaurantId, {
      orderRef: tipId,
      amountMinor: input.amountMinor,
      currency: order.currency,
      returnUrl: input.returnUrl,
      customerPhone: order.customer?.phone ?? '',
      ...(order.customer?.fullName ? { customerName: order.customer.fullName } : {}),
      ...(customerIp ? { customerIp } : {}),
    });
    await this.prisma.courierTip.update({
      where: { id: tipId },
      data: { providerRef: opened.session.sessionId, provider: opened.providerCode, paymentMode: opened.paymentMode },
    });
    return { tipId, session: opened.session };
  }

  // -- Provider notifications -------------------------------------------------------------

  /** Null when the reference is not a tip; otherwise what the notification did. */
  async handleWebhook(
    event: GatewayWebhookEvent,
    scope: WebhookScope,
  ): Promise<GatewayWebhookEvent['status'] | 'IGNORED' | null> {
    if (!UUID.test(event.orderRef)) return null;
    const tip = await this.prisma.courierTip.findUnique({ where: { id: event.orderRef } });
    if (!tip) return null;
    // Only the account that collected the tip may report on it.
    if (tip.paymentMode !== scope.mode) return 'IGNORED';
    if (scope.mode === 'OWN_POS' && tip.restaurantId !== scope.restaurantId) return 'IGNORED';
    if (event.currency !== tip.currency) {
      this.logger.warn(`Tip ${tip.id} notice in ${event.currency}, tip in ${tip.currency}`);
      throw badRequest('WEBHOOK_INVALID', 'Currency mismatch');
    }
    switch (event.status) {
      case 'CAPTURED':
        return this.capture(tip, event);
      case 'FAILED': {
        await this.prisma.courierTip.updateMany({
          where: { id: tip.id, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
        await this.publish(tip.orderId);
        return 'FAILED';
      }
      case 'REFUNDED':
      case 'CHARGEBACK':
        return this.reverse(tip, event);
    }
  }

  private async capture(tip: CourierTip, event: GatewayWebhookEvent): Promise<'CAPTURED' | 'IGNORED'> {
    if (event.amountMinor <= 0) throw badRequest('WEBHOOK_INVALID', 'Empty tip');
    // The provider's capture is the truth: a restarted session may have carried another amount.
    if (event.amountMinor !== tip.amountMinor) {
      this.logger.warn(`Tip ${tip.id} captured ${event.amountMinor}, last asked ${tip.amountMinor}`);
    }
    const fee = Math.min(Math.max(0, event.pspFeeMinor ?? 0), event.amountMinor);
    const at = new Date(event.occurredAt);
    const captured = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.courierTip.updateMany({
        where: { id: tip.id, status: { in: RESTARTABLE } },
        data: {
          status: 'CAPTURED',
          amountMinor: event.amountMinor,
          pspFeeMinor: fee,
          providerRef: event.providerRef,
          capturedAt: at,
        },
      });
      if (count === 0) return false;
      // Platform-collected: the tip rides the next payout to the restaurant, less the provider's fee (docs/BAHSIS.md).
      if (tip.paymentMode === 'PLATFORM_PSP') {
        const base = {
          restaurantId: tip.restaurantId,
          orderId: tip.orderId,
          currency: tip.currency,
          occurredAt: at,
          memo: `tip ${orderShortCode(tip.orderId)}`,
        };
        await tx.ledgerEntry.createMany({
          data: [
            { ...base, type: LedgerEntryType.COURIER_TIP, amountMinor: event.amountMinor },
            ...(fee > 0 ? [{ ...base, type: LedgerEntryType.COURIER_TIP_FEE, amountMinor: -fee }] : []),
          ],
        });
      }
      return true;
    });
    if (!captured) {
      const current = await this.prisma.courierTip.findUnique({ where: { id: tip.id }, select: { status: true } });
      return current?.status === 'CAPTURED' ? 'CAPTURED' : 'IGNORED';
    }
    await this.afterCapture(tip.id);
    return 'CAPTURED';
  }

  private async reverse(tip: CourierTip, event: GatewayWebhookEvent): Promise<'REFUNDED' | 'CHARGEBACK' | 'IGNORED'> {
    const status: CourierTipStatus = event.status === 'CHARGEBACK' ? 'CHARGED_BACK' : 'REFUNDED';
    const at = new Date(event.occurredAt);
    const reversed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.courierTip.updateMany({
        where: { id: tip.id, status: 'CAPTURED' },
        data: { status, reversedAt: at },
      });
      if (count === 0) return false;
      // The restaurant bears refunds and chargebacks; the provider keeps its fee (docs/BAHSIS.md).
      if (tip.paymentMode === 'PLATFORM_PSP') {
        const current = await tx.courierTip.findUniqueOrThrow({ where: { id: tip.id } });
        await tx.ledgerEntry.create({
          data: {
            restaurantId: tip.restaurantId,
            orderId: tip.orderId,
            type: LedgerEntryType.COURIER_TIP,
            amountMinor: -current.amountMinor,
            currency: tip.currency,
            occurredAt: at,
            memo: `tip ${orderShortCode(tip.orderId)} ${status === 'CHARGED_BACK' ? 'chargeback' : 'refund'}`,
          },
        });
      }
      return true;
    });
    if (!reversed) {
      const current = await this.prisma.courierTip.findUnique({ where: { id: tip.id }, select: { status: true } });
      return current?.status === status ? (event.status === 'CHARGEBACK' ? 'CHARGEBACK' : 'REFUNDED') : 'IGNORED';
    }
    await this.publish(tip.orderId);
    return event.status === 'CHARGEBACK' ? 'CHARGEBACK' : 'REFUNDED';
  }

  /** Hand-over, the courier's push and the tracking page; none of them may undo the capture. */
  private async afterCapture(tipId: string): Promise<void> {
    const tip = await this.prisma.courierTip.findUniqueOrThrow({
      where: { id: tipId },
      include: { restaurant: { select: { name: true, defaultLocale: true } } },
    });
    if (tip.deliveryRequestId) await this.passThrough(tip.id);
    if (tip.courierMembershipId) {
      try {
        const recipient = await this.recipientOf(tip.orderId);
        if (recipient?.kind === 'OWN') {
          const locale = tip.restaurant.defaultLocale;
          await this.push.notifyUsers(
            [recipient.userId],
            'tip.received',
            {
              restaurant: tip.restaurant.name,
              code: orderShortCode(tip.orderId),
              amount: formatMoney(
                { amountMinor: tipNetMinor(tip.amountMinor, tip.pspFeeMinor), currency: tip.currency },
                locale,
              ),
            },
            { kind: 'trip', tripId: recipient.tripId },
            { restaurantId: tip.restaurantId, localeFallback: locale },
          );
        }
      } catch (err) {
        this.logger.warn(`Tip ${tip.id} push failed: ${(err as Error).message}`);
      }
    }
    await this.publish(tip.orderId);
  }

  /** Hands the net tip to the courier network; the outcome stays on the tip for the report and a retry. */
  private async passThrough(tipId: string): Promise<void> {
    const tip = await this.prisma.courierTip.findUnique({
      where: { id: tipId },
      include: { deliveryRequest: { select: { providerRef: true, provider: { select: { code: true } } } } },
    });
    if (!tip || tip.status !== 'CAPTURED' || tip.passThroughStatus === 'SENT') return;
    const request = tip.deliveryRequest;
    try {
      const adapter = request ? this.couriers.get(request.provider.code) : null;
      if (!request?.providerRef || !adapter?.addTip) throw new Error('The network takes no tips');
      const sent = await adapter.addTip(
        request.providerRef,
        tipNetMinor(tip.amountMinor, tip.pspFeeMinor),
        tip.currency,
      );
      await this.prisma.courierTip.update({
        where: { id: tip.id },
        data: { passThroughStatus: 'SENT', passThroughRef: sent.providerRef, passThroughAttempts: { increment: 1 } },
      });
    } catch (err) {
      this.logger.warn(`Tip ${tip.id} hand-over failed: ${(err as Error).message}`);
      await this.prisma.courierTip.update({
        where: { id: tip.id },
        data: { passThroughStatus: 'FAILED', passThroughAttempts: { increment: 1 } },
      });
    }
  }

  private async publish(orderId: string): Promise<void> {
    this.realtime.publishMany(await this.orders.eventsForOrder(orderId));
  }

  // -- Restaurant ---------------------------------------------------------------------------

  /** Retries a failed hand-over to the courier network. */
  async retryPassThrough(restaurantId: string, tipId: string): Promise<TipDTO> {
    const tip = await this.prisma.courierTip.findFirst({ where: { id: tipId, restaurantId } });
    if (!tip) throw notFound('NOT_FOUND', 'Tip not found');
    // Claimed before the call so two retries never hand the tip over twice.
    const { count } = await this.prisma.courierTip.updateMany({
      where: { id: tip.id, status: 'CAPTURED', passThroughStatus: 'FAILED' },
      data: { passThroughStatus: null },
    });
    if (count === 0) throw conflict('TIP_UNAVAILABLE', 'Nothing to hand over for this tip');
    await this.passThrough(tip.id);
    const row = await this.prisma.courierTip.findUniqueOrThrow({ where: { id: tip.id }, include: REPORT_INCLUDE });
    return toDto(row);
  }

  async report(restaurantId: string, days: number): Promise<TipsReportDTO> {
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { currency: true },
    });
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.courierTip.findMany({
      where: { restaurantId, currency: restaurant.currency, capturedAt: { gte: since }, status: { in: [...SETTLED] } },
      include: REPORT_INCLUDE,
      orderBy: { capturedAt: 'desc' },
      take: REPORT_ROW_CAP,
    });
    const totals = emptyTotals();
    const couriers = new Map<string, CourierTipsRowDTO>();
    const networks = new Map<string, NetworkTipsRowDTO>();
    for (const row of rows) {
      if (row.status !== 'CAPTURED') continue;
      addTo(totals, row);
      if (row.courier) {
        const entry = couriers.get(row.courier.id) ?? {
          membershipId: row.courier.id,
          name: row.courier.user.fullName,
          ...emptyTotals(),
        };
        addTo(entry, row);
        couriers.set(row.courier.id, entry);
      } else if (row.deliveryRequest) {
        const provider = row.deliveryRequest.provider;
        const entry = networks.get(provider.code) ?? {
          providerCode: provider.code,
          name: provider.name,
          failedPassThrough: 0,
          ...emptyTotals(),
        };
        addTo(entry, row);
        if (row.passThroughStatus === 'FAILED') entry.failedPassThrough += 1;
        networks.set(provider.code, entry);
      }
    }
    return {
      days,
      currency: restaurant.currency,
      totals,
      couriers: [...couriers.values()].sort((a, b) => b.netMinor - a.netMinor),
      networks: [...networks.values()].sort((a, b) => b.netMinor - a.netMinor),
      recent: rows.slice(0, RECENT_LIMIT).map(toDto),
    };
  }
}

const REPORT_INCLUDE = {
  courier: { select: { id: true, user: { select: { fullName: true } } } },
  deliveryRequest: { select: { provider: { select: { code: true, name: true } } } },
} satisfies Prisma.CourierTipInclude;

type ReportRow = Prisma.CourierTipGetPayload<{ include: typeof REPORT_INCLUDE }>;

function emptyTotals(): TipTotalsDTO {
  return { count: 0, grossMinor: 0, feeMinor: 0, netMinor: 0 };
}

function addTo(totals: TipTotalsDTO, row: Pick<CourierTip, 'amountMinor' | 'pspFeeMinor'>): void {
  totals.count += 1;
  totals.grossMinor += row.amountMinor;
  totals.feeMinor += row.pspFeeMinor;
  totals.netMinor += tipNetMinor(row.amountMinor, row.pspFeeMinor);
}

function toDto(row: ReportRow): TipDTO {
  return {
    id: row.id,
    orderId: row.orderId,
    orderShortCode: orderShortCode(row.orderId),
    status: row.status,
    amountMinor: row.amountMinor,
    pspFeeMinor: row.pspFeeMinor,
    netMinor: tipNetMinor(row.amountMinor, row.pspFeeMinor),
    currency: row.currency,
    capturedAt: row.capturedAt?.toISOString() ?? null,
    recipient: row.courier?.user.fullName ?? row.deliveryRequest?.provider.name ?? '',
    passThroughStatus: row.passThroughStatus,
  };
}
