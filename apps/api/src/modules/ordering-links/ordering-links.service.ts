import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OrderStatus } from '@resget/database';
import { ORDERING_LINKS_WINDOW_DAYS, ORDER_SOURCES, orderSourceFromParam, orderingLink } from '@resget/shared';
import type { OrderingLinksDTO } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Orders that never went ahead are not counted for a channel. */
const NOT_COUNTED: OrderStatus[] = [
  'PENDING_PAYMENT',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_RESTAURANT',
  'REJECTED',
  'REFUNDED',
];

/** One link per outside channel and what each brought (docs/SIPARIS_BAGLANTILARI.md). */
@Injectable()
export class OrderingLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async links(restaurantId: string, now = new Date()): Promise<OrderingLinksDTO> {
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { slug: true, currency: true, customDomain: true, customDomainVerifiedAt: true },
    });
    const baseUrl =
      restaurant.customDomain && restaurant.customDomainVerifiedAt
        ? `https://${restaurant.customDomain}/`
        : `${this.config.getOrThrow<string>('PUBLIC_APP_URL').replace(/\/$/, '')}/${restaurant.slug}`;
    const since = new Date(now.getTime() - ORDERING_LINKS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const groups = await this.prisma.order.groupBy({
      by: ['source'],
      where: {
        restaurantId,
        channel: 'RESTAURANT_SITE',
        placedAt: { gte: since },
        status: { notIn: NOT_COUNTED },
      },
      _count: { _all: true },
      _sum: { chargedToCustomerMinor: true },
    });
    const bySource = new Map<string, { orders: number; revenueMinor: number }>();
    let otherOrders = 0;
    for (const group of groups) {
      const source = orderSourceFromParam(group.source);
      if (!source) {
        otherOrders += group._count._all;
        continue;
      }
      bySource.set(source, { orders: group._count._all, revenueMinor: group._sum.chargedToCustomerMinor ?? 0 });
    }
    return {
      baseUrl,
      currency: restaurant.currency,
      windowDays: ORDERING_LINKS_WINDOW_DAYS,
      links: ORDER_SOURCES.map((source) => ({
        source,
        url: orderingLink(baseUrl, source),
        orders: bySource.get(source)?.orders ?? 0,
        revenueMinor: bySource.get(source)?.revenueMinor ?? 0,
      })),
      otherOrders,
    };
  }
}
