import { Injectable } from '@nestjs/common';
import {
  CONVERSION_EXCLUDED_ORDER_STATUSES,
  KPI_ACTIVE_WINDOW_DAYS,
  ORDER_CHANNEL_KEYS,
  TABLE_QR_FUNNEL_STEPS,
  ordersPerRestaurantPerDay,
} from '@resget/shared';
import type { KpiRangeDays, OrderChannel, PlatformKpiDTO } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from '../admin/admin.service';
import { forbidden } from '../../common/api-error';
import { PlatformService } from './platform.service';

const DAY_MS = 86_400_000;
const PLACED = { notIn: ['PENDING_PAYMENT' as const] };

/**
 * The platform funnels and KPI board (docs/HUNILER.md). Counts and sums
 * across every restaurant, never rows: a platform marketing user sees how
 * the network grows without seeing anyone's customers.
 */
@Injectable()
export class KpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly admin: AdminService,
  ) {}

  async board(
    user: { id: string; isSuperAdmin: boolean },
    days: KpiRangeDays,
    now: Date = new Date(),
  ): Promise<PlatformKpiDTO> {
    const context = await this.platform.context(user);
    if (!context.permissions.includes('platform.marketing.view')) {
      throw forbidden('PLATFORM_ACCESS_DENIED', 'No platform marketing access');
    }
    if (!context.features.includes('kpi_dashboard'))
      throw forbidden('FEATURE_DISABLED', 'The KPI board is switched off');

    const to = now;
    const from = new Date(now.getTime() - days * DAY_MS);
    const range = { gte: from, lte: to };
    const ownOrders = { placedAt: range, status: PLACED, restaurant: { isPlatform: false } };
    const [
      total,
      listed,
      trials,
      activeRows,
      ordersInRange,
      byChannelRows,
      firstOrders,
      moneyRows,
      daily,
      qrRows,
      leads,
      cohort,
      districts,
    ] = await Promise.all([
      this.prisma.restaurant.count({ where: { isActive: true, isPlatform: false } }),
      this.prisma.restaurant.count({ where: { isActive: true, isPlatform: false, isListed: true } }),
      this.prisma.restaurantSubscription.count({
        where: { status: 'TRIALING', trialEndsAt: { gt: now }, restaurant: { isPlatform: false } },
      }),
      this.prisma.order.groupBy({
        by: ['restaurantId'],
        where: {
          placedAt: { gte: new Date(now.getTime() - KPI_ACTIVE_WINDOW_DAYS * DAY_MS), lte: now },
          status: PLACED,
          restaurant: { isPlatform: false },
        },
      }),
      this.prisma.order.groupBy({ by: ['restaurantId'], where: ownOrders, _count: { _all: true } }),
      this.prisma.order.groupBy({ by: ['channel'], where: ownOrders, _count: { _all: true } }),
      this.prisma.restaurantCustomer.count({ where: { firstOrderAt: range, restaurant: { isPlatform: false } } }),
      this.prisma.order.groupBy({
        by: ['currency'],
        where: {
          placedAt: range,
          status: { notIn: [...CONVERSION_EXCLUDED_ORDER_STATUSES] },
          restaurant: { isPlatform: false },
        },
        _sum: { itemsGrossMinor: true, platformCommissionMinor: true },
      }),
      this.prisma.$queryRaw<{ day: Date; orders: number }[]>`
        SELECT date_trunc('day', o."placedAt") AS day, COUNT(*)::int AS orders
        FROM orders o JOIN restaurants r ON r.id = o."restaurantId"
        WHERE o."placedAt" >= ${from} AND o."placedAt" <= ${to}
          AND o.status <> 'PENDING_PAYMENT' AND r."isPlatform" = false
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ outcome: string; sessions: number }[]>`
        SELECT q.outcome::text AS outcome, COUNT(DISTINCT q."sessionId")::int AS sessions
        FROM qr_scan_events q
        WHERE q."createdAt" >= ${from} AND q."createdAt" <= ${to}
        GROUP BY 1`,
      this.prisma.restaurantCustomer.count({ where: { restaurantId: context.restaurantId, createdAt: range } }),
      this.prisma.restaurant.findMany({
        where: { isPlatform: false, createdAt: range },
        select: { id: true, isListed: true },
      }),
      this.admin.density(days),
    ]);

    const totalOrders = ordersInRange.reduce((n, r) => n + r._count._all, 0);
    const byChannel = Object.fromEntries(ORDER_CHANNEL_KEYS.map((c) => [c, 0])) as Record<`${OrderChannel}`, number>;
    for (const row of byChannelRows) byChannel[row.channel] = row._count._all;

    // The sign-up cohort of the range: how many got listed, took a first order, are active now.
    const cohortIds = cohort.map((r) => r.id);
    const [cohortWithOrders, cohortActive] = cohortIds.length
      ? await Promise.all([
          this.prisma.order.groupBy({
            by: ['restaurantId'],
            where: { restaurantId: { in: cohortIds }, status: PLACED },
          }),
          this.prisma.order.groupBy({
            by: ['restaurantId'],
            where: {
              restaurantId: { in: cohortIds },
              status: PLACED,
              placedAt: { gte: new Date(now.getTime() - KPI_ACTIVE_WINDOW_DAYS * DAY_MS) },
            },
          }),
        ])
      : [[], []];

    const dayCounts = new Map(daily.map((d) => [d.day.toISOString().slice(0, 10), d.orders]));
    const series: { date: string; orders: number }[] = [];
    const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    for (let t = start.getTime(); t <= to.getTime(); t += DAY_MS) {
      const date = new Date(t).toISOString().slice(0, 10);
      series.push({ date, orders: dayCounts.get(date) ?? 0 });
    }
    const qr = new Map(qrRows.map((r) => [r.outcome, r.sessions]));

    return {
      days,
      from: from.toISOString(),
      to: to.toISOString(),
      restaurants: { total, listed, active: activeRows.length, trials },
      orders: {
        total: totalOrders,
        perRestaurantPerDay: ordersPerRestaurantPerDay(totalOrders, ordersInRange.length, days),
        byChannel,
        firstOrders,
        repeatOrders: Math.max(0, totalOrders - firstOrders),
      },
      money: moneyRows
        .map((m) => ({
          currency: m.currency,
          gmvMinor: m._sum.itemsGrossMinor ?? 0,
          commissionMinor: m._sum.platformCommissionMinor ?? 0,
        }))
        .sort((a, b) => b.gmvMinor - a.gmvMinor),
      daily: series,
      funnels: {
        tableQr: TABLE_QR_FUNNEL_STEPS.map((key) => ({ key, count: qr.get(key) ?? 0 })),
        restaurants: [
          { key: 'leads', count: leads },
          { key: 'signups', count: cohort.length },
          { key: 'listed', count: cohort.filter((r) => r.isListed).length },
          { key: 'firstOrder', count: cohortWithOrders.length },
          { key: 'active', count: cohortActive.length },
        ],
      },
      districts,
    };
  }
}
