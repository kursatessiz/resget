import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUTO_REFUND_STATUSES,
  PARTIAL_REFUND_ORDER_STATUSES,
  REFUND_CLAIM_STALE_MS,
  allocateRefund,
  canStartRefund,
  isOnlinePayment,
  isRefundClaimLive,
  REFUND_RETRY_BACKOFF_MINUTES,
  isRefundRetryDue,
  itemsRefundMinor,
  refundableMinor,
  refundedQuantities,
} from '@resget/shared';
import type {
  OrderActor,
  OrderDetailDTO,
  OrderRefundSourceValue,
  OrderStatus,
  RefundItem,
  RefundOrderInput,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { OrdersService } from '../orders/orders.service';
import { OrderNotificationsService } from '../orders/order-notifications.service';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentsRegistry } from './payments.registry';
import { MealCardsRegistry } from './meal-cards.registry';
import { conflict, notFound } from '../../common/api-error';
import type { ApiErrorCode } from '../../common/api-error';

const SWEEP_MS = 60_000;

type RefundFailureCode = Extract<
  ApiErrorCode,
  'REFUND_IN_PROGRESS' | 'REFUND_DECLINED' | 'REFUND_PROVIDER_ERROR' | 'REFUND_UNAVAILABLE'
>;

interface RefundRun {
  actor: OrderActor;
  actorUserId: string | null;
  reason: string;
  source: OrderRefundSourceValue;
  /** Staff refunds also record money taken at the door as given back by hand; the automatic path never does. */
  includeDoor: boolean;
  now: Date;
}

/** What one payment refund books besides the money: why, who, which items (docs/ODEME.md, "Kısmi iade"). */
interface RefundContext {
  source: OrderRefundSourceValue;
  reason: string;
  actorUserId: string | null;
  items: RefundItem[] | null;
  /**
   * A partial refund is a staff action on the screen: a failed attempt is
   * reported there and leaves no failure mark for the automatic retry,
   * which only gives back whole cancelled orders.
   */
  partial: boolean;
  claimId: string | null;
  now: Date;
}

interface CapturedPayment {
  id: string;
  method: string;
  provider: string;
  providerRef: string | null;
  paymentMode: 'OWN_POS' | 'PLATFORM_PSP';
  status: string;
  amountMinor: number;
  refundedMinor: number;
  collectedByUserId: string | null;
}

/**
 * Refunds (docs/ODEME.md, "İade"). Money goes back the way it came: an
 * online payment through the gateway or issuer that captured it, with the
 * credentials of that same connection; money taken at the door is given
 * back by the restaurant's hand and only recorded here. Each payment is
 * claimed before its gateway call so two screens (or the retry sweep) can
 * never refund it twice. A cancelled order's online payment is refunded
 * automatically; a failed attempt is retried with back-off and staff can
 * always retry. A completed order is refunded only on a staff request.
 */
@Injectable()
export class RefundsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RefundsService.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly notifications: OrderNotificationsService,
    private readonly realtime: RealtimeService,
    private readonly payments: PaymentsRegistry,
    private readonly issuers: MealCardsRegistry,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
    private readonly features: FeatureFlagsService,
  ) {
    this.orders.setRefundAfterCancel((orderId) => this.refundAfterCancel(orderId));
  }

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('REFUND_RETRY') === 'off') return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Staff request (`orders.refund`): without items or an amount every captured
   * payment of a cancelled or completed order goes back; with them, part of a
   * completed order (refundPart).
   */
  async refund(
    restaurantId: string,
    orderId: string,
    input: RefundOrderInput,
    actorUserId: string,
    canSeeContacts: boolean,
  ): Promise<OrderDetailDTO> {
    if (input.items || input.amountMinor !== undefined) {
      await this.features.assertEnabled('partial_refunds', restaurantId);
      await this.refundPart(restaurantId, orderId, input, actorUserId, 'STAFF');
      return this.orders.detail(restaurantId, orderId, canSeeContacts);
    }
    const now = new Date();
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, restaurantId },
      select: { status: true, payments: true },
    });
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    if (!canStartRefund(order.status, order.payments, now)) {
      if (order.payments.some((p) => isRefundClaimLive(p.refundRequestedAt, now))) {
        throw conflict('REFUND_IN_PROGRESS', 'A refund is already in flight');
      }
      throw conflict('REFUND_NOT_ALLOWED', 'Nothing to refund on this order');
    }
    const failure = await this.run(orderId, {
      actor: 'RESTAURANT',
      actorUserId,
      reason: input.reason,
      source: 'STAFF',
      includeDoor: true,
      now,
    });
    if (failure) throw conflict(failure, 'Refund did not go through');
    return this.orders.detail(restaurantId, orderId, canSeeContacts);
  }

  /**
   * Part of a completed order goes back (docs/ODEME.md, "Kısmi iade"): the
   * chosen items at what the customer paid for them, or an amount, taken
   * from online payments first and then from money taken at the door. The
   * order stays completed until nothing is left, then it is REFUNDED like a
   * full refund. The restaurant bears it; the platform gives back the
   * refunded share of its commission (LedgerService.recordRefund). Returns
   * the amount that went back.
   */
  async refundPart(
    restaurantId: string,
    orderId: string,
    input: RefundOrderInput,
    actorUserId: string,
    source: OrderRefundSourceValue,
    claimId: string | null = null,
  ): Promise<number> {
    const now = new Date();
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, restaurantId },
      select: {
        status: true,
        itemsGrossMinor: true,
        discountMinor: true,
        items: { select: { id: true, quantity: true, lineTotalMinor: true } },
        payments: { orderBy: { createdAt: 'asc' } },
        refunds: { select: { items: true } },
      },
    });
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    if (!PARTIAL_REFUND_ORDER_STATUSES.includes(order.status as OrderStatus)) {
      throw conflict('REFUND_NOT_ALLOWED', 'Only a completed order is refunded in part');
    }
    if (order.payments.some((p) => isRefundClaimLive(p.refundRequestedAt, now))) {
      throw conflict('REFUND_IN_PROGRESS', 'A refund is already in flight');
    }
    const left = order.payments.reduce((n, p) => n + refundableMinor(p), 0);
    if (left === 0) throw conflict('REFUND_NOT_ALLOWED', 'Nothing to refund on this order');
    const items = input.items ?? null;
    let amountMinor = input.amountMinor ?? 0;
    if (items) {
      const given = refundedQuantities(order.refunds.map((r) => ({ items: r.items as RefundItem[] | null })));
      const priced = itemsRefundMinor(order, order.items, items, given);
      if (priced === null || priced === 0) throw conflict('REFUND_ITEMS_INVALID', 'Items cannot be refunded');
      amountMinor = priced;
    }
    if (amountMinor > left) throw conflict('REFUND_AMOUNT_TOO_HIGH', 'More than is left to refund');
    const plan = allocateRefund(order.payments, amountMinor, now);
    if (!plan) throw conflict('REFUND_IN_PROGRESS', 'A refund is already in flight');

    let refunded = 0;
    let failure: RefundFailureCode | null = null;
    for (const [index, step] of plan.entries()) {
      const code = await this.refundPayment(
        orderId,
        restaurantId,
        step.payment,
        step.amountMinor,
        isOnlinePayment(step.payment),
        // The items ride on the first row only, so the quantities given back are counted once.
        {
          source,
          reason: input.reason,
          actorUserId,
          items: index === 0 ? items : null,
          partial: true,
          claimId,
          now,
        },
      );
      if (code) {
        failure = code;
        break;
      }
      refunded += step.amountMinor;
    }
    if (refunded > 0) await this.afterRefund(orderId, 'RESTAURANT', actorUserId, input.reason, refunded);
    if (failure) throw conflict(failure, 'Refund did not go through');
    return refunded;
  }

  /** Right after a cancellation committed; never throws, the cancellation stands whatever the gateway says. */
  async refundAfterCancel(orderId: string): Promise<void> {
    try {
      await this.run(orderId, {
        actor: 'SYSTEM',
        actorUserId: null,
        reason: 'refund after cancellation',
        source: 'CANCELLATION',
        includeDoor: false,
        now: new Date(),
      });
    } catch (error) {
      this.logger.warn(
        `Refund after cancelling ${orderId} failed: ${error instanceof Error ? error.message : 'error'}`,
      );
    }
  }

  /**
   * Retries the online refunds of cancelled orders that did not go through
   * (or never started, if the process stopped in between), each after its
   * back-off; after the last wait only staff retry. Returns how many orders
   * had a payment refunded in this pass.
   */
  async sweep(now: Date = new Date()): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const candidates = await this.prisma.payment.findMany({
        where: {
          status: 'CAPTURED',
          collectedByUserId: null,
          method: { in: ['ONLINE_CARD', 'MEAL_CARD'] },
          order: { status: { in: [...AUTO_REFUND_STATUSES] } },
          // Payments past the last retry are left to the panel; they must not fill the batch and starve new ones.
          refundAttempts: { lte: REFUND_RETRY_BACKOFF_MINUTES.length },
          OR: [
            { refundRequestedAt: null },
            { refundRequestedAt: { lt: new Date(now.getTime() - REFUND_CLAIM_STALE_MS) } },
          ],
        },
        select: { orderId: true, refundAttempts: true, refundLastAttemptAt: true },
        orderBy: { updatedAt: 'asc' },
        take: 100,
      });
      let refunded = 0;
      const seen = new Set<string>();
      for (const candidate of candidates) {
        if (seen.has(candidate.orderId)) continue;
        seen.add(candidate.orderId);
        if (!isRefundRetryDue(candidate.refundAttempts, candidate.refundLastAttemptAt, now)) continue;
        const failure = await this.run(candidate.orderId, {
          actor: 'SYSTEM',
          actorUserId: null,
          reason: 'refund retry',
          source: 'CANCELLATION',
          includeDoor: false,
          now,
        });
        if (!failure) refunded += 1;
      }
      return refunded;
    } catch (error) {
      this.logger.error(`Refund sweep failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  /** Refunds what can be refunded on one order; returns the first failure code, or null when everything went back. */
  private async run(orderId: string, opts: RefundRun): Promise<RefundFailureCode | null> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        restaurantId: true,
        status: true,
        payments: { where: { status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } }, orderBy: { createdAt: 'asc' } },
      },
    });
    let failure: RefundFailureCode | null = null;
    let changed = false;
    for (const payment of order.payments) {
      const amountMinor = refundableMinor(payment);
      const online = isOnlinePayment(payment);
      if (amountMinor === 0 || (!online && !opts.includeDoor)) continue;
      const code = await this.refundPayment(order.id, order.restaurantId, payment, amountMinor, online, {
        source: opts.source,
        reason: opts.reason,
        actorUserId: opts.actorUserId,
        items: null,
        partial: false,
        claimId: null,
        now: opts.now,
      });
      if (code) failure ??= code;
      if (code !== 'REFUND_IN_PROGRESS') changed = true;
    }
    if (changed) await this.afterRefund(order.id, opts.actor, opts.actorUserId, opts.reason, null);
    return failure;
  }

  /**
   * After money went back: the order becomes REFUNDED once nothing is left,
   * the screens hear about it, and the customer of a completed order is told
   * (a full refund by its own message, a partial one with the amount). A
   * cancelled order's customer already heard about the refund in the
   * cancellation message.
   */
  private async afterRefund(
    orderId: string,
    actor: OrderActor,
    actorUserId: string | null,
    reason: string,
    partialMinor: number | null,
  ): Promise<void> {
    const leftFrom = await this.prisma.$transaction((tx) =>
      this.orders.closeAsRefunded(tx, orderId, actor, actorUserId, reason),
    );
    this.realtime.publishMany(await this.orders.eventsForOrder(orderId));
    if (leftFrom === 'DELIVERED' || leftFrom === 'PICKED_UP') await this.notifications.notify(orderId, 'REFUNDED');
    else if (leftFrom === null && partialMinor !== null)
      await this.notifications.notifyPartialRefund(orderId, partialMinor);
  }

  private async refundPayment(
    orderId: string,
    restaurantId: string,
    payment: CapturedPayment,
    amountMinor: number,
    online: boolean,
    context: RefundContext,
  ): Promise<RefundFailureCode | null> {
    const { now } = context;
    // The claim: only one attempt per payment at a time, a stale one is taken over.
    const claimed = await this.prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: payment.status as 'CAPTURED' | 'PARTIALLY_REFUNDED',
        refundedMinor: payment.refundedMinor,
        OR: [
          { refundRequestedAt: null },
          { refundRequestedAt: { lt: new Date(now.getTime() - REFUND_CLAIM_STALE_MS) } },
        ],
      },
      data: { refundRequestedAt: now, refundLastAttemptAt: now, refundAttempts: { increment: 1 } },
    });
    if (claimed.count === 0) return 'REFUND_IN_PROGRESS';

    let providerRef: string | null = null;
    let code: RefundFailureCode | null = null;
    if (online) {
      const target = await this.targetFor(restaurantId, payment);
      if (!target || !payment.providerRef) {
        code = 'REFUND_UNAVAILABLE';
      } else {
        try {
          const result = await target.refund(payment.providerRef, amountMinor);
          if (result.ok) providerRef = result.providerRef;
          else code = 'REFUND_DECLINED';
        } catch (error) {
          this.logger.warn(
            `Refund call for payment ${payment.id} failed: ${error instanceof Error ? error.message : 'error'}`,
          );
          code = 'REFUND_PROVIDER_ERROR';
        }
      }
    }

    if (code) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: context.partial ? { refundRequestedAt: null } : { refundRequestedAt: null, refundFailureCode: code },
      });
      return code;
    }
    const refundedMinor = payment.refundedMinor + amountMinor;
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: refundedMinor >= payment.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
          refundedMinor,
          refundedAt: now,
          refundProviderRef: providerRef,
          refundRequestedAt: null,
          refundFailureCode: null,
        },
      });
      // The refund row with its commission share; platform-collected money of a completed order also comes back
      // out of the next payout with the commission share returned in it (docs/MUTABAKAT.md, "Kısmi iade").
      await this.ledger.recordRefund(tx, {
        orderId,
        paymentId: payment.id,
        source: context.source,
        amountMinor,
        items: context.items,
        reason: context.reason,
        actorUserId: context.actorUserId,
        claimId: context.claimId,
        now,
      });
    });
    return null;
  }

  /**
   * The adapter and credentials of the connection that captured the payment:
   * the restaurant's own POS or issuer account (whatever its current status,
   * a past payment can always go back while the credentials exist) or the
   * platform's own merchant. Null when that connection is gone.
   */
  private async targetFor(
    restaurantId: string,
    payment: CapturedPayment,
  ): Promise<{
    refund: (providerRef: string, amountMinor: number) => Promise<{ ok: boolean; providerRef: string | null }>;
  } | null> {
    if (payment.method === 'MEAL_CARD') {
      const adapter = this.issuers.get(payment.provider);
      const connection = await this.prisma.mealCardConnection.findFirst({
        where: { restaurantId, providerCode: payment.provider, encryptedCredentials: { not: null } },
        select: { encryptedCredentials: true },
      });
      if (!adapter || !connection?.encryptedCredentials) return null;
      const credentials = this.payments.cipher.decryptJson(connection.encryptedCredentials);
      return { refund: (ref, amount) => adapter.refund(credentials, ref, amount) };
    }
    const gateway = this.payments.gateway(payment.provider);
    if (!gateway) return null;
    if (payment.paymentMode === 'PLATFORM_PSP') {
      const credentials = this.payments.platformCredentials(payment.provider);
      return { refund: (ref, amount) => gateway.refund(credentials, ref, amount) };
    }
    const connection = await this.prisma.paymentProviderConnection.findFirst({
      where: { restaurantId, providerCode: payment.provider },
      select: { encryptedCredentials: true },
    });
    if (!connection) return null;
    const credentials = this.payments.cipher.decryptJson(connection.encryptedCredentials);
    return { refund: (ref, amount) => gateway.refund(credentials, ref, amount) };
  }
}
