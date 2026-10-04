import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BASE_LOCALE,
  BUNDLED_MESSAGES,
  createTranslator,
  customerPushTemplate,
  dispatchSettingsFrom,
  formatMoney,
  isAutoRefundStatus,
  isDeletedUserPhone,
  isOnlinePayment,
  notificationSettingsFrom,
  orderNotificationTemplate,
  orderShortCode,
  trackingUrl,
} from '@resget/shared';
import type { MessageTemplateKey, OrderStatusValue, PushTemplateKey } from '@resget/shared';

/** What happened: a status change, or part of the order's money went back (docs/ODEME.md, "Kısmi iade"). */
type OrderUpdate = { status: OrderStatusValue } | { partialRefundMinor: number } | { claimDeclined: string };
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { PushService } from '../push/push.service';

/**
 * Transactional order updates to the customer (docs/MESAJLASMA.md). Called
 * after a transition committed; never throws, so a provider outage cannot
 * block the kitchen. A free push goes first to the customer's phones; only
 * when no device took it does the restaurant's wallet pay for the message,
 * in its preferred channel with the SMS fallback it chose.
 */
@Injectable()
export class OrderNotificationsService {
  private readonly logger = new Logger(OrderNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly push: PushService,
    private readonly config: ConfigService,
  ) {}

  async notify(orderId: string, status: OrderStatusValue): Promise<void> {
    await this.safely(orderId, { status });
  }

  /** A partial refund went back to the customer: the amount, in their language and the order's currency. */
  async notifyPartialRefund(orderId: string, amountMinor: number): Promise<void> {
    await this.safely(orderId, { partialRefundMinor: amountMinor });
  }

  /** The restaurant declined the customer's missing-item claim; the reason goes with it. */
  async notifyClaimDeclined(orderId: string, reason: string): Promise<void> {
    await this.safely(orderId, { claimDeclined: reason });
  }

  /** A customer reported missing items: everyone who may refund hears about it (push only, free). */
  async alertStaffOfClaim(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, restaurantId: true, restaurant: { select: { name: true } } },
      });
      if (!order) return;
      await this.push.notifyRestaurantStaff(
        order.restaurantId,
        'orders.refund',
        'order.claimFiled',
        { restaurant: order.restaurant.name, code: orderShortCode(order.id) },
        { kind: 'orders' },
      );
    } catch (error) {
      this.logger.warn(`Claim alert for ${orderId} skipped: ${error instanceof Error ? error.message : 'error'}`);
    }
  }

  private async safely(orderId: string, update: OrderUpdate): Promise<void> {
    try {
      await this.send(orderId, update);
    } catch (error) {
      const what = 'status' in update ? update.status : 'claimDeclined' in update ? 'claim declined' : 'partial refund';
      this.logger.warn(
        `Order ${orderId} ${what} notification skipped: ${error instanceof Error ? error.message : 'error'}`,
      );
    }
  }

  private async send(orderId: string, update: OrderUpdate): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        fulfillment: true,
        restaurantId: true,
        currency: true,
        trackingToken: true,
        promisedReadyAt: true,
        rejectReason: true,
        addressSnapshot: true,
        customerUserId: true,
        customer: { select: { phone: true, locale: true } },
        restaurant: { select: { name: true, defaultLocale: true, notificationSettings: true, dispatchSettings: true } },
        payments: { select: { method: true, status: true, collectedByUserId: true } },
      },
    });
    if (!order) return;
    const settings = notificationSettingsFrom(order.restaurant.notificationSettings);
    if (!settings.customerOrderUpdates) return;

    const locale = order.customer?.locale ?? order.restaurant.defaultLocale;
    const messages = BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE];
    const t = createTranslator({ locale, messages, fallback: BUNDLED_MESSAGES[BASE_LOCALE] });
    const minutes = order.promisedReadyAt
      ? Math.max(1, Math.round((order.promisedReadyAt.getTime() - Date.now()) / 60_000))
      : dispatchSettingsFrom(order.restaurant.dispatchSettings).defaultPrepMinutes;
    const params = {
      restaurant: order.restaurant.name,
      code: orderShortCode(order.id),
      minutes,
      url: order.trackingToken
        ? trackingUrl(this.config.getOrThrow<string>('PUBLIC_APP_URL'), order.trackingToken)
        : '',
      reason:
        'claimDeclined' in update
          ? t('messaging.template.reasonSuffix', { reason: update.claimDeclined })
          : order.rejectReason
            ? t('messaging.template.reasonSuffix', { reason: order.rejectReason })
            : '',
      amount:
        'partialRefundMinor' in update
          ? formatMoney({ amountMinor: update.partialRefundMinor, currency: order.currency }, locale)
          : '',
    };
    const status = 'status' in update ? update.status : null;
    // A cancellation tells the customer about the online payment in the same message (docs/ODEME.md, "İade").
    const refund = status && isAutoRefundStatus(status) ? refundNoteOf(order.payments) : null;
    const pushParams = { ...params, refund: refund ? t(`messaging.push.refundSuffix.${refund}`) : '' };
    const messageParams = { ...params, refund: refund ? t(`messaging.template.refundSuffix.${refund}`) : '' };

    // Push is free and reaches the app directly; a device that took it spares the restaurant the paid message.
    const otherKey = 'claimDeclined' in update ? 'order.claimDeclined' : 'order.partiallyRefunded';
    const pushKey: PushTemplateKey | null = status
      ? customerPushTemplate(order.fulfillment, status)
      : order.fulfillment === 'DINE_IN'
        ? null
        : otherKey;
    if (pushKey && order.customerUserId) {
      const outcome = await this.push.notifyUsers(
        [order.customerUserId],
        pushKey,
        pushParams,
        order.trackingToken ? { kind: 'tracking', token: order.trackingToken } : { kind: 'orders' },
        { restaurantId: order.restaurantId, localeFallback: order.restaurant.defaultLocale },
      );
      if (outcome.sent > 0) return;
    }

    const templateKey: MessageTemplateKey | null = status
      ? orderNotificationTemplate(order.fulfillment, status)
      : order.fulfillment === 'DINE_IN'
        ? null
        : otherKey;
    if (!templateKey) return;
    // A deleted account has no number to write to (docs/KISISEL_VERI.md).
    const phone = isDeletedUserPhone(order.customer?.phone)
      ? null
      : (order.customer?.phone ?? contactPhoneOf(order.addressSnapshot));
    if (!phone) return;
    await this.messaging.send({
      restaurantId: order.restaurantId,
      channel: settings.channel,
      to: phone,
      templateKey,
      params: messageParams,
      locale,
      billable: true,
      fallbackToSms: settings.fallbackToSms,
    });
  }
}

/** "done" when every online payment went back, "pending" while one still waits, null when nothing was paid online. */
function refundNoteOf(
  payments: { method: string; status: string; collectedByUserId: string | null }[],
): 'done' | 'pending' | null {
  const online = payments.filter(
    (p) =>
      isOnlinePayment(p) && (p.status === 'CAPTURED' || p.status === 'PARTIALLY_REFUNDED' || p.status === 'REFUNDED'),
  );
  if (online.length === 0) return null;
  return online.every((p) => p.status === 'REFUNDED') ? 'done' : 'pending';
}

function contactPhoneOf(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const phone = (snapshot as { contactPhone?: unknown }).contactPhone;
  return typeof phone === 'string' && phone.length > 0 ? phone : null;
}
