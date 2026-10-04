import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@resget/database';
import { HEALTH_LEVELS, SIGNAL_DROP_WINDOW_DAYS, healthLevel, healthScore, restaurantSignals } from '@resget/shared';
import type { HealthLevel, RestaurantHealthDTO, RestaurantHealthPageDTO } from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;
/** Orders that never became real orders do not count as activity. */
const NOT_ORDERS: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.REJECTED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_RESTAURANT,
];

/**
 * Restaurant health for the console (docs/KAYIP_RISKI.md, module
 * restaurant_health, global switch): active restaurants with a signal that
 * they are drifting away, the riskiest first.
 */
@Injectable()
export class RestaurantHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
  ) {}

  async list(now: Date): Promise<RestaurantHealthPageDTO> {
    await this.features.assertEnabled('restaurant_health', null);
    const windowStart = new Date(now.getTime() - SIGNAL_DROP_WINDOW_DAYS * DAY_MS);
    const previousStart = new Date(now.getTime() - 2 * SIGNAL_DROP_WINDOW_DAYS * DAY_MS);
    const counted = { status: { notIn: NOT_ORDERS } };

    const [restaurants, last, current, previous, overdue] = await Promise.all([
      this.prisma.restaurant.findMany({
        where: { isActive: true, isPlatform: false },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          listingSuspendedAt: true,
          billingPaymentMethodId: true,
          subscription: { select: { status: true, trialEndsAt: true } },
        },
      }),
      this.prisma.order.groupBy({ by: ['restaurantId'], where: counted, _max: { placedAt: true } }),
      this.prisma.order.groupBy({
        by: ['restaurantId'],
        where: { ...counted, placedAt: { gte: windowStart } },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['restaurantId'],
        where: { ...counted, placedAt: { gte: previousStart, lt: windowStart } },
        _count: { _all: true },
      }),
      this.prisma.commissionInvoice.groupBy({ by: ['restaurantId'], where: { status: 'OVERDUE' } }),
    ]);

    const lastAt = new Map(last.map((row) => [row.restaurantId, row._max.placedAt]));
    const currentCount = new Map(current.map((row) => [row.restaurantId, row._count._all]));
    const previousCount = new Map(previous.map((row) => [row.restaurantId, row._count._all]));
    const overdueIds = new Set(overdue.map((row) => row.restaurantId));

    const items: RestaurantHealthDTO[] = [];
    for (const restaurant of restaurants) {
      const trialEndsAt =
        restaurant.subscription?.status === 'TRIALING' ? (restaurant.subscription.trialEndsAt ?? null) : null;
      const lastOrderAt = lastAt.get(restaurant.id) ?? null;
      const ordersLastWindow = currentCount.get(restaurant.id) ?? 0;
      const ordersPreviousWindow = previousCount.get(restaurant.id) ?? 0;
      const signals = restaurantSignals(
        {
          createdAt: restaurant.createdAt,
          lastOrderAt,
          ordersLastWindow,
          ordersPreviousWindow,
          hasOverdueInvoice: overdueIds.has(restaurant.id),
          listingSuspended: restaurant.listingSuspendedAt !== null,
          trialEndsAt,
          hasBillingCard: restaurant.billingPaymentMethodId !== null,
        },
        now,
      );
      const level = healthLevel(signals);
      if (!level) continue;
      items.push({
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        level,
        score: healthScore(signals),
        signals,
        lastOrderAt: lastOrderAt?.toISOString() ?? null,
        ordersLastWindow,
        ordersPreviousWindow,
        trialEndsAt: trialEndsAt?.toISOString() ?? null,
      });
    }
    items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const counts = Object.fromEntries(HEALTH_LEVELS.map((level) => [level, 0])) as Record<HealthLevel, number>;
    for (const item of items) counts[item.level] += 1;
    return { items, checked: restaurants.length, counts };
  }
}
