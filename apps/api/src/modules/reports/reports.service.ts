import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { orderShortCode, reportDaysAllowed } from '@resget/shared';
import type { FulfillmentTypeValue, OrderChannelValue, ReportSummaryDTO } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { forbidden, notFound } from '../../common/api-error';

const COMPLETED = ['DELIVERED', 'PICKED_UP'] as const;
const CANCELLED = ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'REJECTED', 'REFUNDED'] as const;
const DAY_MS = 86_400_000;

const completedSelect = Prisma.validator<Prisma.OrderSelect>()({
  id: true,
  fulfillment: true,
  channel: true,
  chargedToCustomerMinor: true,
  platformCommissionMinor: true,
  commissionVatMinor: true,
  completedAt: true,
  placedAt: true,
  currency: true,
  paymentMethod: true,
  customer: { select: { fullName: true } },
});
type CompletedRow = Prisma.OrderGetPayload<{ select: typeof completedSelect }>;

/** Restaurant reports (docs/PANEL.md): aggregates of order snapshots over a trailing range of UTC days. */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(restaurantId: string, days: number, analytics: boolean): Promise<ReportSummaryDTO> {
    if (!reportDaysAllowed(days, analytics)) {
      throw forbidden('PLAN_FEATURE_REQUIRED', 'Longer report ranges need the analytics feature');
    }
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { currency: true },
    });
    if (!restaurant) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
    const { from, to } = this.range(days);
    const [completed, cancelledOrders, topItems, ratingAgg, recentRatings] = await Promise.all([
      this.prisma.order.findMany({
        where: { restaurantId, status: { in: [...COMPLETED] }, completedAt: { gte: from, lt: to } },
        select: completedSelect,
        orderBy: { completedAt: 'asc' },
      }),
      this.prisma.order.count({
        where: { restaurantId, status: { in: [...CANCELLED] }, placedAt: { gte: from, lt: to } },
      }),
      this.prisma.orderItem.groupBy({
        by: ['nameSnapshot'],
        where: { order: { restaurantId, status: { in: [...COMPLETED] }, completedAt: { gte: from, lt: to } } },
        _sum: { quantity: true, lineTotalMinor: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 10,
      }),
      this.prisma.orderRating.aggregate({
        where: { restaurantId, createdAt: { gte: from, lt: to } },
        _avg: { score: true },
        _count: { _all: true },
      }),
      this.prisma.orderRating.findMany({
        where: { restaurantId, createdAt: { gte: from, lt: to } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { orderId: true, score: true, comment: true, createdAt: true },
      }),
    ]);
    const grossMinor = completed.reduce((n, o) => n + o.chargedToCustomerMinor, 0);
    const commissionMinor = completed.reduce((n, o) => n + o.platformCommissionMinor + o.commissionVatMinor, 0);
    return {
      days,
      from: from.toISOString(),
      to: to.toISOString(),
      currency: restaurant.currency,
      completedOrders: completed.length,
      cancelledOrders,
      grossMinor,
      averageBasketMinor: completed.length ? Math.round(grossMinor / completed.length) : 0,
      commissionMinor,
      byFulfillment: this.buckets(completed, (o) => o.fulfillment) as ReportSummaryDTO['byFulfillment'],
      byChannel: this.buckets(completed, (o) => o.channel) as ReportSummaryDTO['byChannel'],
      topItems: topItems.map((row) => ({
        name: row.nameSnapshot,
        quantity: row._sum.quantity ?? 0,
        grossMinor: row._sum.lineTotalMinor ?? 0,
      })),
      daily: this.daily(completed, from, days),
      ratings: {
        average: ratingAgg._avg.score === null ? null : Math.round(ratingAgg._avg.score * 10) / 10,
        count: ratingAgg._count._all,
        recent: recentRatings.map((r) => ({
          shortCode: orderShortCode(r.orderId),
          score: r.score,
          comment: r.comment,
          createdAt: r.createdAt.toISOString(),
        })),
      },
      analytics,
    };
  }

  /** Completed orders of the range as CSV (PRO analytics); amounts in minor units with the currency column. */
  async ordersCsv(restaurantId: string, days: number): Promise<string> {
    const { from, to } = this.range(days);
    const rows = await this.prisma.order.findMany({
      where: { restaurantId, status: { in: [...COMPLETED] }, completedAt: { gte: from, lt: to } },
      select: completedSelect,
      orderBy: { completedAt: 'asc' },
    });
    const header = [
      'order',
      'placedAt',
      'completedAt',
      'fulfillment',
      'channel',
      'paymentMethod',
      'customer',
      'chargedMinor',
      'commissionMinor',
      'commissionVatMinor',
      'currency',
    ];
    const lines = rows.map((o) =>
      [
        orderShortCode(o.id),
        o.placedAt.toISOString(),
        o.completedAt?.toISOString() ?? '',
        o.fulfillment,
        o.channel,
        o.paymentMethod ?? '',
        o.customer?.fullName ?? '',
        o.chargedToCustomerMinor,
        o.platformCommissionMinor,
        o.commissionVatMinor,
        o.currency,
      ]
        .map(csvCell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\r\n') + '\r\n';
  }

  private range(days: number): { from: Date; to: Date } {
    const now = new Date();
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return { from: new Date(to.getTime() - days * DAY_MS), to };
  }

  private buckets(
    rows: CompletedRow[],
    key: (row: CompletedRow) => FulfillmentTypeValue | OrderChannelValue,
  ): { key: string; orders: number; grossMinor: number }[] {
    const map = new Map<string, { key: string; orders: number; grossMinor: number }>();
    for (const row of rows) {
      const k = key(row);
      const bucket = map.get(k) ?? { key: k, orders: 0, grossMinor: 0 };
      bucket.orders += 1;
      bucket.grossMinor += row.chargedToCustomerMinor;
      map.set(k, bucket);
    }
    return [...map.values()].sort((a, b) => b.orders - a.orders);
  }

  private daily(rows: CompletedRow[], from: Date, days: number): ReportSummaryDTO['daily'] {
    const series = Array.from({ length: days }, (_, i) => ({
      date: new Date(from.getTime() + i * DAY_MS).toISOString().slice(0, 10),
      orders: 0,
      grossMinor: 0,
    }));
    const index = new Map(series.map((d, i) => [d.date, i]));
    for (const row of rows) {
      const slot = index.get((row.completedAt ?? row.placedAt).toISOString().slice(0, 10));
      if (slot === undefined) continue;
      series[slot].orders += 1;
      series[slot].grossMinor += row.chargedToCustomerMinor;
    }
    return series;
  }
}

/** A cell that may hold a comma, a quote or a line break is quoted; a leading formula character is neutralised. */
function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
