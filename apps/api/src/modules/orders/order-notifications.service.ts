import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BASE_LOCALE,
  BUNDLED_MESSAGES,
  createTranslator,
  dispatchSettingsFrom,
  notificationSettingsFrom,
  orderNotificationTemplate,
  orderShortCode,
  trackingUrl,
} from '@resget/shared';
import type { OrderStatusValue } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';

/**
 * Transactional order updates to the customer (docs/MESAJLASMA.md). Called
 * after a transition committed; never throws, so a provider outage cannot
 * block the kitchen. The restaurant's wallet pays, in its preferred channel
 * with the SMS fallback it chose.
 */
@Injectable()
export class OrderNotificationsService {
  private readonly logger = new Logger(OrderNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
  ) {}

  async notify(orderId: string, status: OrderStatusValue): Promise<void> {
    try {
      await this.send(orderId, status);
    } catch (error) {
      this.logger.warn(
        `Order ${orderId} ${status} notification skipped: ${error instanceof Error ? error.message : 'error'}`,
      );
    }
  }

  private async send(orderId: string, status: OrderStatusValue): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        fulfillment: true,
        restaurantId: true,
        trackingToken: true,
        promisedReadyAt: true,
        rejectReason: true,
        addressSnapshot: true,
        customer: { select: { phone: true, locale: true } },
        restaurant: { select: { name: true, defaultLocale: true, notificationSettings: true, dispatchSettings: true } },
      },
    });
    if (!order) return;
    const templateKey = orderNotificationTemplate(order.fulfillment, status);
    if (!templateKey) return;
    const settings = notificationSettingsFrom(order.restaurant.notificationSettings);
    if (!settings.customerOrderUpdates) return;
    const phone = order.customer?.phone ?? contactPhoneOf(order.addressSnapshot);
    if (!phone) return;

    const locale = order.customer?.locale ?? order.restaurant.defaultLocale;
    const messages = BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE];
    const t = createTranslator({ locale, messages, fallback: BUNDLED_MESSAGES[BASE_LOCALE] });
    const minutes = order.promisedReadyAt
      ? Math.max(1, Math.round((order.promisedReadyAt.getTime() - Date.now()) / 60_000))
      : dispatchSettingsFrom(order.restaurant.dispatchSettings).defaultPrepMinutes;
    await this.messaging.send({
      restaurantId: order.restaurantId,
      channel: settings.channel,
      to: phone,
      templateKey,
      params: {
        restaurant: order.restaurant.name,
        code: orderShortCode(order.id),
        minutes,
        url: order.trackingToken
          ? trackingUrl(this.config.getOrThrow<string>('PUBLIC_APP_URL'), order.trackingToken)
          : '',
        reason: order.rejectReason ? t('messaging.template.reasonSuffix', { reason: order.rejectReason }) : '',
      },
      locale,
      billable: true,
      fallbackToSms: settings.fallbackToSms,
    });
  }
}

function contactPhoneOf(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const phone = (snapshot as { contactPhone?: unknown }).contactPhone;
  return typeof phone === 'string' && phone.length > 0 ? phone : null;
}
