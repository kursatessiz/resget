import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentConnectionStatus } from '@resget/database';
import { isPaidBeforePlacement, isTerminalOrderStatus } from '@resget/shared';
import type {
  CheckoutSessionDTO,
  CollectPaymentInput,
  GatewayWebhookEvent,
  HostedCheckoutParams,
  HostedCheckoutSession,
  OrderDetailDTO,
  OrderPaymentIntent,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { OrdersService } from '../orders/orders.service';
import type { ResolvedPaymentIntent } from '../orders/orders.service';
import { PaymentsRegistry } from './payments.registry';
import { MealCardsService } from './meal-cards.service';
import { MealCardsRegistry } from './meal-cards.registry';
import { LedgerService } from '../ledger/ledger.service';
import { OrderNotificationsService } from '../orders/order-notifications.service';
import { badRequest, conflict, notFound } from '../../common/api-error';

export type WebhookKind = 'meal-cards' | 'pos' | 'platform';

/** Who collected a notified payment: the restaurant's POS (with its restaurant) or the platform's merchant account. */
export type WebhookScope = { mode: 'OWN_POS'; restaurantId: string } | { mode: 'PLATFORM_PSP' };

/**
 * A notification whose reference is not an order but something else the
 * restaurant or the platform collects: a courier tip (docs/BAHSIS.md) or a
 * share of an open tab (docs/ACIK_HESAP.md). Returns null when the reference
 * is not its own, so the next handler or the order payment path takes it.
 */
export type ReferenceWebhookHandler = (
  event: GatewayWebhookEvent,
  scope: WebhookScope,
) => Promise<GatewayWebhookEvent['status'] | 'IGNORED' | null>;

/** A hosted session the restaurant's own POS or the platform's merchant opened, and which of them it was. */
export interface OpenedHostedCheckout {
  session: HostedCheckoutSession;
  providerCode: string;
  paymentMode: 'OWN_POS' | 'PLATFORM_PSP';
}

/** What the webhook endpoint answers: JSON by default, the provider's own acknowledgement or a browser redirect when the adapter asks. */
export interface WebhookOutcome {
  received: true;
  status: GatewayWebhookEvent['status'] | 'IGNORED';
  ack?: { contentType: string; body: string };
  browserRedirectUrl?: string;
}

/**
 * The payment step of an order (docs/YEMEK_KARTI.md, docs/ODEME.md): which
 * methods an order may use, the hosted checkout for online methods, the
 * signed webhook that confirms them, and the collection recorded at the
 * door for the rest. Card data never passes through here.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  private readonly referenceHandlers: ReferenceWebhookHandler[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
    private readonly payments: PaymentsRegistry,
    private readonly mealCards: MealCardsService,
    private readonly issuers: MealCardsRegistry,
    private readonly config: ConfigService,
    private readonly ledger: LedgerService,
    private readonly notifications: OrderNotificationsService,
  ) {
    this.orders.setPaymentIntentResolver((restaurantId, intent) => this.resolveIntent(restaurantId, intent));
  }

  /** Registered by the tips and tabs modules so their notifications reach them before the order payment path. */
  addReferenceHandler(handler: ReferenceWebhookHandler): void {
    this.referenceHandlers.push(handler);
  }

  /** The provider code of the platform's own merchant account (docs/ODEME.md). */
  platformProviderCode(): string {
    return this.config.get<string>('PAYMENT_PROVIDER', 'MOCK');
  }

  /**
   * A hosted card session for any amount the restaurant takes online: its
   * own POS under OWN_POS, the platform's merchant under PLATFORM_PSP. Each
   * session carries the notification address of the account that collects.
   */
  async openHostedCheckout(restaurantId: string, params: HostedCheckoutParams): Promise<OpenedHostedCheckout> {
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: {
        paymentMode: true,
        paymentConnection: { select: { id: true, providerCode: true, status: true, encryptedCredentials: true } },
      },
    });
    if (restaurant.paymentMode === 'OWN_POS') {
      const pos = restaurant.paymentConnection;
      if (!pos || pos.status !== PaymentConnectionStatus.ACTIVE) {
        throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', 'The restaurant has no active POS connection');
      }
      const gateway = this.payments.gateway(pos.providerCode);
      if (!gateway) throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', `No adapter for ${pos.providerCode}`);
      const session = await gateway.createHostedCheckout(this.payments.cipher.decryptJson(pos.encryptedCredentials), {
        ...params,
        notifyUrl: this.webhookUrl('pos', pos.id),
      });
      return { session, providerCode: pos.providerCode, paymentMode: 'OWN_POS' };
    }
    const code = this.platformProviderCode();
    const gateway = this.payments.gateway(code);
    if (!gateway) throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', `No adapter for ${code}`);
    const session = await gateway.createHostedCheckout(this.payments.platformCredentials(code), {
      ...params,
      notifyUrl: this.webhookUrl('platform', code),
    });
    return { session, providerCode: code, paymentMode: 'PLATFORM_PSP' };
  }

  /**
   * Pays an order waiting in PENDING_PAYMENT with a card of a platform
   * wallet (docs/CUZDAN.md). The charge runs at the platform's merchant,
   * so the payment keeps the platform's provider (refunds go there) and the
   * card it came from. Returns where the customer goes next: nowhere when
   * captured, the 3-D Secure page, or the hosted page after a decline.
   */
  async chargeSavedCard(orderId: string, savedPaymentMethodId: string, returnUrl: string): Promise<string | null> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        payments: { where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const payment = order.payments[0];
    if (order.status !== 'PENDING_PAYMENT' || !payment || payment.paymentMode !== 'PLATFORM_PSP') {
      throw conflict('PAYMENT_STATE_INVALID', 'Order is not waiting for a platform payment');
    }
    const card = await this.prisma.savedPaymentMethod.findUniqueOrThrow({ where: { id: savedPaymentMethodId } });
    const provider = this.platformProviderCode();
    const result = await this.payments
      .vaultFor(card.provider)
      .charge({
        token: this.payments.cipher.decrypt(card.encryptedToken),
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        merchantRef: 'platform',
        orderRef: order.id,
        returnUrl,
      })
      .catch((err: unknown) => {
        this.logger.warn(`Wallet charge for order ${order.id} failed: ${(err as Error).message}`);
        return null;
      });
    if (result?.status === 'CAPTURED') {
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'CAPTURED',
            provider,
            providerRef: result.providerRef,
            savedPaymentMethodId: card.id,
            capturedAt: new Date(),
          },
        });
        const row = await this.orders.loadRow(tx, order.id);
        if (row.status === 'PENDING_PAYMENT') {
          await this.orders.applyTransition(tx, row, 'PLACED', 'SYSTEM', null, { reason: 'wallet payment captured' });
        }
      });
      this.realtime.publishMany(await this.orders.eventsForOrder(order.id));
      return null;
    }
    if (result?.status === 'REQUIRES_3DS' && result.redirectUrl) {
      // The capture arrives on the platform merchant's webhook like any platform card payment.
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { provider, providerRef: result.providerRef, savedPaymentMethodId: card.id },
      });
      return result.redirectUrl;
    }
    // Declined: the same order is paid on the hosted page instead.
    const session = await this.checkoutFor(order.id, returnUrl);
    return session.session.redirectUrl;
  }

  /** Validates a payment intent against what the restaurant accepts and decides whether the order waits for payment. */
  async resolveIntent(restaurantId: string, intent: OrderPaymentIntent): Promise<ResolvedPaymentIntent> {
    const accepted = await this.mealCards.acceptedMethods(restaurantId);
    switch (intent.method) {
      case 'ONLINE_CARD': {
        if (!accepted.onlineCard) throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', 'No card gateway for this restaurant');
        const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
          where: { id: restaurantId },
          select: { paymentMode: true, paymentConnection: { select: { providerCode: true } } },
        });
        const providerCode =
          restaurant.paymentMode === 'OWN_POS'
            ? (restaurant.paymentConnection?.providerCode ?? 'POS')
            : this.config.get<string>('PAYMENT_PROVIDER', 'MOCK');
        return { intent, providerCode, paidBefore: true };
      }
      case 'CASH_ON_DELIVERY':
        if (!accepted.cashOnDelivery) throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', 'Cash on delivery is off');
        return { intent, providerCode: 'CASH', paidBefore: false };
      case 'CARD_ON_DELIVERY':
        if (!accepted.cardOnDelivery) throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', 'Card on delivery is off');
        return { intent, providerCode: 'POS_ON_DELIVERY', paidBefore: false };
      case 'MEAL_CARD': {
        const code = intent.providerCode!;
        const online = accepted.mealCardsOnline.some((c) => c.providerCode === code);
        const door = accepted.mealCardsOnDelivery.some((c) => c.providerCode === code);
        const paidBefore = isPaidBeforePlacement(intent, online);
        if (paidBefore && !online) throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', `${code} is not accepted online`);
        if (!paidBefore && !door) throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', `${code} is not accepted at the door`);
        return { intent, providerCode: code, paidBefore };
      }
    }
  }

  /** Staff-side checkout: a hosted payment session for an order that waits for its online payment. */
  async startCheckout(
    restaurantId: string,
    orderId: string,
    returnUrl: string,
    customerIp?: string,
  ): Promise<CheckoutSessionDTO> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, restaurantId } });
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    return this.checkoutFor(order.id, returnUrl, customerIp);
  }

  /** Customer-side checkout, reached with the order's tracking token right after placement. */
  async startPublicCheckout(
    trackingToken: string,
    returnUrl: string,
    customerIp?: string,
  ): Promise<CheckoutSessionDTO> {
    const order = await this.prisma.order.findUnique({ where: { trackingToken }, select: { id: true } });
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    return this.checkoutFor(order.id, returnUrl, customerIp);
  }

  private async checkoutFor(orderId: string, returnUrl: string, customerIp?: string): Promise<CheckoutSessionDTO> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        payments: { where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 1 },
        customer: { select: { phone: true, fullName: true } },
      },
    });
    const payment = order.payments[0];
    if (order.status !== 'PENDING_PAYMENT' || !payment) {
      throw conflict('PAYMENT_STATE_INVALID', 'Order is not waiting for an online payment');
    }
    const params: HostedCheckoutParams = {
      orderRef: order.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      returnUrl,
      customerPhone: order.customer?.phone ?? '',
      ...(order.customer?.fullName ? { customerName: order.customer.fullName } : {}),
      ...(customerIp ? { customerIp } : {}),
    };

    if (payment.method === 'MEAL_CARD') {
      const connectionId = await this.mealCards.onlineConnectionFor(order.restaurantId, payment.provider);
      const connection = connectionId ? await this.mealCards.onlineCredentials(connectionId) : null;
      const adapter = this.issuers.get(payment.provider);
      if (!connection || !adapter) throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', 'Issuer is no longer accepted online');
      const session = await adapter.createHostedCheckout(connection.credentials, params);
      await this.prisma.payment.update({ where: { id: payment.id }, data: { providerRef: session.sessionId } });
      return { paymentId: payment.id, session };
    }

    if (payment.method === 'ONLINE_CARD') {
      // The platform's merchant answers on its own webhook address; the restaurant's POS on its connection's.
      const { session } = await this.openHostedCheckout(order.restaurantId, params);
      await this.prisma.payment.update({ where: { id: payment.id }, data: { providerRef: session.sessionId } });
      return { paymentId: payment.id, session };
    }
    throw conflict('PAYMENT_STATE_INVALID', `${payment.method} is collected at the door, not online`);
  }

  /**
   * A provider's notification. The connection id in the URL selects the
   * credentials that verify the signature; a bad signature is a 400 and
   * nothing is written. Repeated notifications are idempotent.
   */
  private webhookUrl(kind: WebhookKind, connectionId: string): string {
    const base = this.config.getOrThrow<string>('PUBLIC_API_URL').replace(/\/+$/, '');
    return `${base}/webhooks/payments/${kind}/${connectionId}`;
  }

  async handleWebhook(
    kind: WebhookKind,
    connectionId: string,
    rawBody: string,
    headers: Record<string, string | undefined>,
    query: Record<string, string | undefined> = {},
  ): Promise<WebhookOutcome> {
    let event: GatewayWebhookEvent;
    // Known from the connection; the platform's merchant serves every restaurant, so its payments name their own.
    let restaurantId: string | null;
    try {
      if (kind === 'platform') {
        // Only the merchant the environment configures; production refuses MOCK there (apps/api/src/config/env.ts).
        const gateway = connectionId === this.platformProviderCode() ? this.payments.gateway(connectionId) : null;
        if (!gateway) throw new Error('Unknown platform provider');
        restaurantId = null;
        event = await gateway.parseWebhook(this.payments.platformCredentials(connectionId), rawBody, headers, query);
      } else if (kind === 'meal-cards') {
        const connection = await this.mealCards.onlineCredentials(connectionId);
        const adapter = connection ? this.issuers.get(connection.providerCode) : null;
        if (!connection || !adapter) throw new Error('Unknown connection');
        restaurantId = connection.restaurantId;
        event = await adapter.parseWebhook(connection.credentials, rawBody, headers);
      } else {
        const pos = await this.prisma.paymentProviderConnection.findUnique({ where: { id: connectionId } });
        const gateway = pos ? this.payments.gateway(pos.providerCode) : null;
        if (!pos || !gateway) throw new Error('Unknown connection');
        restaurantId = pos.restaurantId;
        event = await gateway.parseWebhook(
          this.payments.cipher.decryptJson(pos.encryptedCredentials),
          rawBody,
          headers,
          query,
        );
      }
    } catch (err) {
      this.logger.warn(`Webhook rejected (${kind}/${connectionId}): ${(err as Error).message}`);
      throw badRequest('WEBHOOK_INVALID', 'Webhook could not be verified');
    }

    const reply = (status: WebhookOutcome['status']): WebhookOutcome => ({
      received: true,
      status,
      ...(event.ack ? { ack: event.ack } : {}),
      ...(event.browserRedirectUrl ? { browserRedirectUrl: event.browserRedirectUrl } : {}),
    });
    // A tip or a tab share travels with its own reference; meal-card issuers never collect one.
    if (kind !== 'meal-cards') {
      const scope: WebhookScope = restaurantId ? { mode: 'OWN_POS', restaurantId } : { mode: 'PLATFORM_PSP' };
      for (const handler of this.referenceHandlers) {
        const handled = await handler(event, scope);
        if (handled) return reply(handled);
      }
    }

    const payment = await this.prisma.payment.findFirst({
      where: restaurantId
        ? { orderId: event.orderRef, restaurantId }
        : { orderId: event.orderRef, paymentMode: 'PLATFORM_PSP', method: 'ONLINE_CARD' },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) return reply('IGNORED');
    if (payment.status === 'CAPTURED' && event.status === 'CAPTURED') return reply('CAPTURED');
    // A late capture notice never undoes a refund that already happened.
    if (payment.status === 'REFUNDED' && event.status !== 'REFUNDED') return reply('IGNORED');
    // After a chargeback the money is gone; later notices change nothing (a reversal is an ADJUSTMENT by the platform).
    if (payment.status === 'CHARGED_BACK') return reply(event.status === 'CHARGEBACK' ? 'CHARGEBACK' : 'IGNORED');
    if (event.status === 'CHARGEBACK') {
      if (payment.status !== 'CAPTURED' && payment.status !== 'PARTIALLY_REFUNDED') return reply('IGNORED');
      const amountMinor = payment.amountMinor - payment.refundedMinor;
      // The restaurant bears the chargeback and the platform takes no commission on the order (docs/MUTABAKAT.md):
      // the refund row gives back what is left of the commission and stamps the order, the ledger takes the amount
      // out of the next payout for platform-collected money.
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'CHARGED_BACK' } });
        const share = await this.ledger.recordRefund(tx, {
          orderId: payment.orderId,
          paymentId: payment.id,
          source: 'CHARGEBACK',
          amountMinor,
          reason: 'chargeback reported by the provider',
          now: new Date(event.occurredAt),
        });
        await tx.auditLog.create({
          data: {
            restaurantId: payment.restaurantId,
            action: 'payment.charged_back',
            entity: 'Payment',
            entityId: payment.id,
            meta: { amountMinor, commissionReturnedMinor: share.commissionMinor + share.commissionVatMinor },
          },
        });
      });
      this.realtime.publishMany(await this.orders.eventsForOrder(payment.orderId));
      return reply('CHARGEBACK');
    }
    if (event.status === 'CAPTURED' && event.amountMinor !== payment.amountMinor) {
      this.logger.warn(`Webhook amount ${event.amountMinor} differs from payment ${payment.amountMinor}`);
      throw badRequest('WEBHOOK_INVALID', 'Amount mismatch');
    }

    const refundedNow = event.status === 'REFUNDED' && payment.status !== 'REFUNDED';
    const leftFrom = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: event.status === 'CHARGEBACK' ? 'CHARGED_BACK' : event.status,
          // A refund notice keeps the capture reference; a refund started on the platform already stored its own.
          ...(event.status === 'REFUNDED' ? {} : { providerRef: event.providerRef, pspFeeMinor: event.pspFeeMinor }),
          capturedAt: event.status === 'CAPTURED' ? new Date(event.occurredAt) : payment.capturedAt,
          refundedMinor: event.status === 'REFUNDED' ? payment.amountMinor : payment.refundedMinor,
          ...(refundedNow
            ? { refundedAt: new Date(event.occurredAt), refundRequestedAt: null, refundFailureCode: null }
            : {}),
        },
      });
      if (event.status === 'CAPTURED') {
        const order = await this.orders.loadRow(tx, payment.orderId);
        if (order.status === 'PENDING_PAYMENT') {
          await this.orders.applyTransition(tx, order, 'PLACED', 'SYSTEM', null, { reason: 'payment captured' });
        }
      }
      if (event.status !== 'REFUNDED' || !refundedNow) return null;
      // What was still on the payment went back; booked like any refund (docs/MUTABAKAT.md, "Kısmi iade").
      await this.ledger.recordRefund(tx, {
        orderId: payment.orderId,
        paymentId: payment.id,
        source: 'PROVIDER',
        amountMinor: payment.amountMinor - payment.refundedMinor,
        reason: 'refund reported by the provider',
        now: new Date(event.occurredAt),
      });
      // A refund made in the provider's own dashboard closes the order the same way (docs/ODEME.md, "İade").
      return this.orders.closeAsRefunded(tx, payment.orderId, 'SYSTEM', null, 'refund reported by the provider');
    });
    this.realtime.publishMany(await this.orders.eventsForOrder(payment.orderId));
    if (leftFrom === 'DELIVERED' || leftFrom === 'PICKED_UP')
      await this.notifications.notify(payment.orderId, 'REFUNDED');
    return reply(event.status);
  }

  /** Cash, card or a meal card taken at the door or the counter; the actual method may differ from the intent. */
  async collect(
    restaurantId: string,
    orderId: string,
    input: CollectPaymentInput,
    actorUserId: string,
    canSeeContacts: boolean,
  ): Promise<OrderDetailDTO> {
    const row = await this.orders.loadRow(this.prisma, orderId);
    if (row.restaurantId !== restaurantId) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    if (row.status === 'PENDING_PAYMENT') throw conflict('PAYMENT_STATE_INVALID', 'Order waits for an online payment');
    const completed = row.status === 'DELIVERED' || row.status === 'PICKED_UP';
    if (isTerminalOrderStatus(row.status) && !completed) {
      throw conflict('PAYMENT_STATE_INVALID', `Nothing to collect on a ${row.status} order`);
    }
    const accepted = await this.mealCards.acceptedMethods(restaurantId);
    if (input.method === 'MEAL_CARD') {
      if (!accepted.mealCardsOnDelivery.some((c) => c.providerCode === input.providerCode)) {
        throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', `${input.providerCode} is not accepted at the door`);
      }
    } else if (input.method === 'CASH_ON_DELIVERY' ? !accepted.cashOnDelivery : !accepted.cardOnDelivery) {
      throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', `${input.method} is off`);
    }
    const current = this.orders.paymentOf(row);
    if (current.dueMinor === 0) throw conflict('PAYMENT_STATE_INVALID', 'Order is already paid');
    const amountMinor = input.amountMinor ?? current.dueMinor;
    if (amountMinor > current.dueMinor) throw conflict('PAYMENT_STATE_INVALID', 'Amount exceeds what is due');
    const provider =
      input.method === 'MEAL_CARD'
        ? input.providerCode!
        : input.method === 'CASH_ON_DELIVERY'
          ? 'CASH'
          : 'POS_ON_DELIVERY';
    const pending = row.payments[0]?.status === 'PENDING' ? row.payments[0] : null;
    const data = {
      provider,
      method: input.method,
      status: 'CAPTURED' as const,
      amountMinor,
      providerRef: input.reference ?? null,
      capturedAt: new Date(),
      collectedByUserId: actorUserId,
      paymentMode: 'OWN_POS' as const,
    };
    await this.prisma.$transaction(async (tx) => {
      if (pending) await tx.payment.update({ where: { id: pending.id }, data });
      else await tx.payment.create({ data: { restaurantId, orderId, currency: row.currency, ...data } });
      await tx.order.update({
        where: { id: orderId },
        data: { paymentMethod: input.method, paymentProvider: input.method === 'MEAL_CARD' ? provider : null },
      });
    });
    this.realtime.publishMany(await this.orders.eventsForOrder(orderId));
    return this.orders.detail(restaurantId, orderId, canSeeContacts);
  }
}
