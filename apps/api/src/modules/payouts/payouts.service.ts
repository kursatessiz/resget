import { Injectable } from '@nestjs/common';
import { LedgerEntryType, PayoutStatus, Prisma } from '@resget/database';
import {
  PAYABLE_LINE_TYPES,
  addBusinessDays,
  orderShortCode,
  payoutBusinessDaysFor,
  previousPayoutPeriod,
} from '@resget/shared';
import type {
  AdminPayoutDTO,
  AdminPayoutPageDTO,
  AdminPayoutQuery,
  FinanceLedgerDTO,
  LedgerEntryDTO,
  PayoutDTO,
  PayoutRunReportDTO,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { conflict, notFound } from '../../common/api-error';

const payoutSelect = Prisma.validator<Prisma.PayoutSelect>()({
  id: true,
  restaurantId: true,
  periodStart: true,
  periodEnd: true,
  amountMinor: true,
  currency: true,
  status: true,
  scheduledFor: true,
  sentAt: true,
  settledAt: true,
  providerRef: true,
  failureReason: true,
  createdAt: true,
  restaurant: { select: { id: true, name: true, slug: true } },
  _count: { select: { ledgerEntries: true } },
});
type PayoutRow = Prisma.PayoutGetPayload<{ select: typeof payoutSelect }>;

const payableTypes = [...PAYABLE_LINE_TYPES] as LedgerEntryType[];

/**
 * Weekly payouts (docs/MUTABAKAT.md): the payable lines of a closed week
 * roll into one payout per restaurant, scheduled within the country's
 * legal window. Money moves by bank transfer today and the console marks
 * the payout sent, settled or failed; a payout provider adapter comes with
 * the PSP contract.
 */
@Injectable()
export class PayoutsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Closes the last complete week for every restaurant with unassigned payable lines; idempotent per period. */
  async rollDue(now: Date = new Date()): Promise<PayoutRunReportDTO> {
    const period = previousPayoutPeriod(now);
    const groups = await this.prisma.ledgerEntry.groupBy({
      by: ['restaurantId', 'currency'],
      where: { payoutId: null, invoiceId: null, type: { in: payableTypes }, occurredAt: { lt: period.periodEnd } },
      _sum: { amountMinor: true },
    });
    let created = 0;
    const totals = new Map<string, number>();
    for (const group of groups) {
      const amountMinor = group._sum.amountMinor ?? 0;
      const exists = await this.prisma.payout.findFirst({
        where: { restaurantId: group.restaurantId, periodStart: period.periodStart, currency: group.currency },
        select: { id: true },
      });
      if (exists) continue;
      const restaurant = await this.prisma.restaurant.findUnique({
        where: { id: group.restaurantId },
        select: { countryCode: true },
      });
      if (!restaurant) continue;
      await this.prisma.$transaction(async (tx) => {
        const payout = await tx.payout.create({
          data: {
            restaurantId: group.restaurantId,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            amountMinor,
            currency: group.currency,
            scheduledFor: addBusinessDays(period.periodEnd, payoutBusinessDaysFor(restaurant.countryCode)),
          },
          select: { id: true },
        });
        await tx.ledgerEntry.updateMany({
          where: {
            restaurantId: group.restaurantId,
            currency: group.currency,
            payoutId: null,
            invoiceId: null,
            type: { in: payableTypes },
            occurredAt: { lt: period.periodEnd },
          },
          data: { payoutId: payout.id },
        });
      });
      created += 1;
      totals.set(group.currency, (totals.get(group.currency) ?? 0) + amountMinor);
    }
    return {
      asOf: now.toISOString(),
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      created,
      totals: [...totals.entries()].map(([currency, amountMinor]) => ({ currency, amountMinor })),
    };
  }

  // -- Restaurant panel ------------------------------------------------------------------------

  async ledger(restaurantId: string): Promise<FinanceLedgerDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { paymentMode: true, currency: true },
    });
    if (!restaurant) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
    const [pending, entries, payouts] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({
        where: { restaurantId, payoutId: null, invoiceId: null, type: { in: payableTypes } },
        _sum: { amountMinor: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { restaurantId },
        orderBy: { occurredAt: 'desc' },
        take: 100,
        select: {
          id: true,
          type: true,
          amountMinor: true,
          currency: true,
          occurredAt: true,
          orderId: true,
          payoutId: true,
          invoiceId: true,
          memo: true,
        },
      }),
      this.prisma.payout.findMany({
        where: { restaurantId },
        orderBy: { periodStart: 'desc' },
        take: 24,
        select: payoutSelect,
      }),
    ]);
    return {
      paymentMode: restaurant.paymentMode,
      currency: restaurant.currency,
      pendingPayableMinor: pending._sum.amountMinor ?? 0,
      entries: entries.map((e): LedgerEntryDTO => ({
        id: e.id,
        type: e.type,
        amountMinor: e.amountMinor,
        currency: e.currency,
        occurredAt: e.occurredAt.toISOString(),
        orderId: e.orderId,
        orderShortCode: e.orderId ? orderShortCode(e.orderId) : null,
        payoutId: e.payoutId,
        invoiceId: e.invoiceId,
        memo: e.memo,
      })),
      payouts: payouts.map((p) => this.toDto(p)),
    };
  }

  // -- Console ---------------------------------------------------------------------------------

  async list(query: AdminPayoutQuery): Promise<AdminPayoutPageDTO> {
    const where: Prisma.PayoutWhereInput = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: payoutSelect,
      }),
      this.prisma.payout.count({ where }),
    ]);
    return { items: rows.map((r) => this.toAdminDto(r)), total, page: query.page, pageSize: query.pageSize };
  }

  async markSent(actorUserId: string, id: string, providerRef: string): Promise<AdminPayoutDTO> {
    const payout = await this.require(id);
    if (payout.status !== 'SCHEDULED' && payout.status !== 'FAILED') {
      throw conflict('PAYOUT_STATE_INVALID', 'Only a scheduled or failed payout can be sent');
    }
    await this.prisma.payout.update({
      where: { id },
      data: { status: PayoutStatus.SENT, sentAt: new Date(), providerRef, failureReason: null },
    });
    await this.audit(actorUserId, payout.restaurantId, 'payout.sent', id, { providerRef });
    return this.toAdminDto(await this.require(id));
  }

  async markSettled(actorUserId: string, id: string): Promise<AdminPayoutDTO> {
    const payout = await this.require(id);
    if (payout.status !== 'SENT') throw conflict('PAYOUT_STATE_INVALID', 'Only a sent payout can settle');
    await this.prisma.payout.update({ where: { id }, data: { status: PayoutStatus.SETTLED, settledAt: new Date() } });
    await this.audit(actorUserId, payout.restaurantId, 'payout.settled', id, {});
    return this.toAdminDto(await this.require(id));
  }

  async markFailed(actorUserId: string, id: string, reason: string): Promise<AdminPayoutDTO> {
    const payout = await this.require(id);
    if (payout.status === 'SETTLED') throw conflict('PAYOUT_STATE_INVALID', 'A settled payout cannot fail');
    await this.prisma.payout.update({ where: { id }, data: { status: PayoutStatus.FAILED, failureReason: reason } });
    await this.audit(actorUserId, payout.restaurantId, 'payout.failed', id, { reason });
    return this.toAdminDto(await this.require(id));
  }

  // -- Internals -------------------------------------------------------------------------------

  private audit(
    actorUserId: string,
    restaurantId: string,
    action: string,
    entityId: string,
    meta: Prisma.InputJsonObject,
  ) {
    return this.prisma.auditLog.create({
      data: { actorUserId, restaurantId, action, entity: 'payout', entityId, meta },
    });
  }

  private async require(id: string): Promise<PayoutRow> {
    const row = await this.prisma.payout.findUnique({ where: { id }, select: payoutSelect });
    if (!row) throw notFound('PAYOUT_NOT_FOUND', 'Payout not found');
    return row;
  }

  private toDto(row: PayoutRow): PayoutDTO {
    return {
      id: row.id,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      amountMinor: row.amountMinor,
      currency: row.currency,
      status: row.status,
      scheduledFor: row.scheduledFor.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      settledAt: row.settledAt?.toISOString() ?? null,
      providerRef: row.providerRef,
      failureReason: row.failureReason,
      entryCount: row._count.ledgerEntries,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toAdminDto(row: PayoutRow): AdminPayoutDTO {
    return { ...this.toDto(row), restaurant: row.restaurant };
  }
}
