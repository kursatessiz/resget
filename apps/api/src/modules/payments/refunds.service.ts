import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUTO_REFUND_STATUSES,
  REFUND_CLAIM_STALE_MS,
  canStartRefund,
  isOnlinePayment,
  isRefundClaimLive,
  isRefundRetryDue,
  refundableMinor,
} from '@resget/shared';
import type { OrderActor, OrderDetailDTO, RefundOrderInput } from '@resget/shared';
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
  /** Staff refunds also record money taken at the door as given back by hand; the automatic path never does. */
  includeDoor: boolean;
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

  /** Staff request (`orders.refund`): every captured payment of a cancelled or completed order goes back. */
  async refund(
    restaurantId: string,
    orderId: string,
    input: RefundOrderInput,
    actorUserId: string,
    canSeeContacts: boolean,
  ): Promise<OrderDetailDTO> {
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
      includeDoor: true,
      now,
    });
    if (failure) throw conflict(failure, 'Refund did not go through');
    return this.orders.detail(restaurantId, orderId, canSeeContacts);
  }

  /** Right after a cancellation committed; never throws, the cancellation stands whatever the gateway says. */
  async refundAfterCancel(orderId: string): Promise<void> {
    try {
      await this.run(orderId, {
        actor: 'SYSTEM',
        actorUserId: null,
        reason: 'refund after cancellation',
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
      const code = await this.refundPayment(order.id, order.restaurantId, payment, amountMinor, online, opts.now);
      if (code) failure ??= code;
      if (code !== 'REFUND_IN_PROGRESS') changed = true;
    }

    const leftFrom = changed
      ? await this.prisma.$transaction((tx) =>
          this.orders.closeAsRefunded(tx, order.id, opts.actor, opts.actorUserId, opts.reason),
        )
      : null;
    if (changed) this.realtime.publishMany(await this.orders.eventsForOrder(order.id));
    // A cancelled order's customer already heard about the refund in the cancellation message.
    if (leftFrom === 'DELIVERED' || leftFrom === 'PICKED_UP') await this.notifications.notify(order.id, 'REFUNDED');
    return failure;
  }

  private async refundPayment(
    orderId: string,
    restaurantId: string,
    payment: CapturedPayment,
    amountMinor: number,
    online: boolean,
    now: Date,
  ): Promise<RefundFailureCode | null> {
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
        data: { refundRequestedAt: null, refundFailureCode: code },
      });
      return code;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'REFUNDED',
          refundedMinor: payment.amountMinor,
          refundedAt: now,
          refundProviderRef: providerRef,
          refundRequestedAt: null,
          refundFailureCode: null,
        },
      });
      // Platform-collected money of a completed order comes back out of the next payout (docs/MUTABAKAT.md).
      await this.ledger.recordRefund(tx, orderId, amountMinor, now);
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
