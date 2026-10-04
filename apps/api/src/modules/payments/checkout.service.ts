import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentConnectionStatus } from '@resget/database';
import { isPaidBeforePlacement, isTerminalOrderStatus } from '@resget/shared';
import type {
  CheckoutSessionDTO,
  CollectPaymentInput,
  GatewayWebhookEvent,
  HostedCheckoutParams,
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

export type WebhookKind = 'meal-cards' | 'pos';

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
        restaurant: {
          select: {
            paymentMode: true,
            paymentConnection: { select: { id: true, providerCode: true, status: true, encryptedCredentials: true } },
          },
        },
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
      if (order.restaurant.paymentMode === 'OWN_POS') {
        const pos = order.restaurant.paymentConnection;
        if (!pos || pos.status !== PaymentConnectionStatus.ACTIVE) {
          throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', 'The restaurant has no active POS connection');
        }
        const gateway = this.payments.gateway(pos.providerCode);
        if (!gateway) throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', `No adapter for ${pos.providerCode}`);
        const credentials = this.payments.cipher.decryptJson(pos.encryptedCredentials);
        // Providers that take the notification address per request get this connection's webhook URL.
        const session = await gateway.createHostedCheckout(credentials, {
          ...params,
          notifyUrl: this.webhookUrl('pos', pos.id),
        });
        await this.prisma.payment.update({ where: { id: payment.id }, data: { providerRef: session.sessionId } });
        return { paymentId: payment.id, session };
      }
      const code = this.config.get<string>('PAYMENT_PROVIDER', 'MOCK');
      const gateway = this.payments.gateway(code);
      if (!gateway) throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', `No adapter for ${code}`);
      // The platform's own merchant credentials come from the environment; the mock needs none.
      const session = await gateway.createHostedCheckout(this.payments.platformCredentials(code), params);
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
    let restaurantId: string;
    try {
      if (kind === 'meal-cards') {
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

    const payment = await this.prisma.payment.findFirst({
      where: { orderId: event.orderRef, restaurantId },
      orderBy: { createdAt: 'desc' },
    });
    const reply = (status: WebhookOutcome['status']): WebhookOutcome => ({
      received: true,
      status,
      ...(event.ack ? { ack: event.ack } : {}),
      ...(event.browserRedirectUrl ? { browserRedirectUrl: event.browserRedirectUrl } : {}),
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
      // The restaurant bears the chargeback and the platform takes no commission on the order (docs/MUTABAKAT.md).
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'CHARGED_BACK' } });
        // No commission on a charged-back order: off the open month, or credited if an invoice already billed it.
        await tx.order.updateMany({
          where: { id: payment.orderId, completedAt: { not: null }, commissionReversedAt: null },
          data: { commissionReversedAt: new Date(event.occurredAt) },
        });
        const booked = await this.ledger.recordChargeback(tx, payment.orderId, amountMinor, new Date(event.occurredAt));
        await tx.auditLog.create({
          data: {
            restaurantId,
            action: 'payment.charged_back',
            entity: 'Payment',
            entityId: payment.id,
            meta: { amountMinor, ledgerLine: booked },
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
      if (event.status !== 'REFUNDED') return null;
      // A refund of platform-collected money is a negative ledger line; the next payout carries it.
      await this.ledger.recordRefund(tx, payment.orderId, payment.amountMinor);
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
