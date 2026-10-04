import { Injectable } from '@nestjs/common';
import type { Prisma } from '@resget/database';
import { CHURN_RISKS, churnThresholds, customerChurnRisk, daysBetween, visibleContact } from '@resget/shared';
import type { ChurnCustomerDTO, ChurnOverviewDTO, ChurnRisk, ChurnWatchRisk } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';

const SWEEP_PAGE = 1000;
const LIST_LIMIT = 100;

/** The fields the churn class is computed from, plus the stored class. */
export interface ChurnRow {
  id: string;
  orderCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  churnRisk: ChurnRisk | null;
}

/**
 * Customer churn classes (docs/KAYIP_RISKI.md). The class is stored on the
 * customer row so segments can target it: order placement sets it, and the
 * sweep moves customers along as quiet days pass. The panel view sweeps its
 * own restaurant first, so it always reads current classes.
 */
@Injectable()
export class ChurnService {
  constructor(private readonly prisma: PrismaService) {}

  /** Brings stored classes up to date; one restaurant or all of them. Returns how many rows changed. */
  async sweep(now: Date, restaurantId?: string): Promise<number> {
    let changed = 0;
    let cursor: string | undefined;
    for (;;) {
      const rows: ChurnRow[] = await this.prisma.restaurantCustomer.findMany({
        where: {
          ...(restaurantId ? { restaurantId } : {}),
          OR: [{ orderCount: { gt: 0 } }, { churnRisk: { not: null } }],
        },
        select: { id: true, orderCount: true, firstOrderAt: true, lastOrderAt: true, churnRisk: true },
        orderBy: { id: 'asc' },
        take: SWEEP_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      changed += await this.apply(rows, now);
      cursor = rows[rows.length - 1]?.id;
      if (rows.length < SWEEP_PAGE) break;
    }
    return changed;
  }

  /** Writes the classes that moved, one update per class. */
  private async apply(rows: ChurnRow[], now: Date): Promise<number> {
    const moves = new Map<ChurnRisk | null, string[]>();
    for (const row of rows) {
      const risk = customerChurnRisk(row, now);
      if (risk === row.churnRisk) continue;
      moves.set(risk, [...(moves.get(risk) ?? []), row.id]);
    }
    let changed = 0;
    for (const [risk, ids] of moves) {
      const result = await this.prisma.restaurantCustomer.updateMany({
        where: { id: { in: ids } },
        data: { churnRisk: risk },
      });
      changed += result.count;
    }
    return changed;
  }

  async overview(restaurantId: string, now: Date): Promise<ChurnOverviewDTO> {
    await this.sweep(now, restaurantId);
    const live: Prisma.RestaurantCustomerWhereInput = { restaurantId, user: { deletedAt: null } };
    const [groups, atRisk, restaurant] = await Promise.all([
      this.prisma.restaurantCustomer.groupBy({
        by: ['churnRisk'],
        where: { ...live, churnRisk: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.restaurantCustomer.aggregate({
        where: { ...live, churnRisk: 'AT_RISK' },
        _sum: { lifetimeGrossMinor: true },
      }),
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { currency: true } }),
    ]);
    const counts = Object.fromEntries(CHURN_RISKS.map((risk) => [risk, 0])) as Record<ChurnRisk, number>;
    for (const group of groups) {
      if (group.churnRisk) counts[group.churnRisk] = group._count._all;
    }
    return {
      counts,
      atRiskLifetimeGrossMinor: atRisk._sum.lifetimeGrossMinor ?? 0,
      currency: restaurant.currency,
    };
  }

  /** The customers in one class, most valuable first; contact details only with the contact permission. */
  async customers(
    restaurantId: string,
    risk: ChurnWatchRisk,
    canSeeContacts: boolean,
    now: Date,
  ): Promise<ChurnCustomerDTO[]> {
    const [rows, restaurant] = await Promise.all([
      this.prisma.restaurantCustomer.findMany({
        where: { restaurantId, churnRisk: risk, user: { deletedAt: null } },
        include: { user: { select: { fullName: true, phone: true } } },
        orderBy: [{ lifetimeGrossMinor: 'desc' }, { lastOrderAt: 'desc' }],
        take: LIST_LIMIT,
      }),
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { currency: true } }),
    ]);
    return rows.flatMap((row) => {
      if (!row.lastOrderAt) return [];
      const contact = visibleContact(row.user);
      return [
        {
          id: row.id,
          fullName: contact?.fullName ?? '',
          phone: canSeeContacts ? (contact?.phone ?? null) : null,
          risk,
          orderCount: row.orderCount,
          lastOrderAt: row.lastOrderAt.toISOString(),
          daysSinceLastOrder: daysBetween(row.lastOrderAt, now),
          usualIntervalDays: churnThresholds(row).usualIntervalDays,
          lifetimeGrossMinor: row.lifetimeGrossMinor,
          currency: restaurant.currency,
          marketingOptIn: row.marketingOptIn,
        },
      ];
    });
  }
}
