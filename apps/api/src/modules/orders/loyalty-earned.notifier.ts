import { Injectable, Logger } from '@nestjs/common';
import { isDeletedUserPhone, notificationSettingsFrom } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { PushService } from '../push/push.service';
import { OrdersService } from './orders.service';

const COMPLETED: readonly string[] = ['DELIVERED', 'PICKED_UP'];

/**
 * Tells the customer about the points a completed order earned, when the
 * restaurant turned it on (docs/SADAKAT.md, `notifyEarned`). Runs after the
 * order is published, outside its transaction; the earn rows are claimed
 * first (`notifiedAt`), so a repeated publish never sends twice. A free push
 * goes first; only when no device took it does the restaurant's wallet pay
 * for the message, in its channel with its SMS fallback. Never throws.
 */
@Injectable()
export class LoyaltyEarnedNotifier {
  private readonly logger = new Logger(LoyaltyEarnedNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly push: PushService,
    orders: OrdersService,
  ) {
    orders.addOrderListener((order) => this.onOrder(order));
  }

  async onOrder(order: { id: string; restaurantId: string; status: string }): Promise<void> {
    if (!COMPLETED.includes(order.status)) return;
    try {
      const program = await this.prisma.loyaltyProgram.findUnique({
        where: { restaurantId: order.restaurantId },
        select: { notifyEarned: true },
      });
      if (!program?.notifyEarned) return;
      const { count } = await this.prisma.loyaltyTransaction.updateMany({
        where: { orderId: order.id, type: { in: ['EARN', 'WELCOME'] }, notifiedAt: null },
        data: { notifiedAt: new Date() },
      });
      if (count === 0) return;
      await this.send(order.id, order.restaurantId);
    } catch (error) {
      this.logger.warn(`Points notice for ${order.id} skipped: ${error instanceof Error ? error.message : 'error'}`);
    }
  }

  private async send(orderId: string, restaurantId: string): Promise<void> {
    const rows = await this.prisma.loyaltyTransaction.findMany({
      where: { orderId, type: { in: ['EARN', 'WELCOME'] } },
      select: {
        points: true,
        customer: {
          select: { loyaltyPoints: true, user: { select: { id: true, phone: true, locale: true } } },
        },
        restaurant: { select: { name: true, defaultLocale: true, notificationSettings: true } },
      },
    });
    const first = rows[0];
    const points = rows.reduce((sum, row) => sum + row.points, 0);
    if (!first || points <= 0) return;
    const { customer, restaurant } = first;
    const locale = customer.user.locale ?? restaurant.defaultLocale;
    const params = {
      restaurant: restaurant.name,
      points: new Intl.NumberFormat(locale).format(points),
      balance: new Intl.NumberFormat(locale).format(customer.loyaltyPoints),
    };
    const pushed = await this.push.notifyUsers(
      [customer.user.id],
      'loyalty.earned',
      params,
      { kind: 'orders' },
      { restaurantId, localeFallback: restaurant.defaultLocale },
    );
    if (pushed.sent > 0) return;
    // A deleted account has no number to write to (docs/KISISEL_VERI.md).
    if (isDeletedUserPhone(customer.user.phone)) return;
    const settings = notificationSettingsFrom(restaurant.notificationSettings);
    await this.messaging.send({
      restaurantId,
      channel: settings.channel,
      to: customer.user.phone,
      templateKey: 'loyalty.earned',
      params,
      locale,
      billable: true,
      fallbackToSms: settings.fallbackToSms,
    });
  }
}
