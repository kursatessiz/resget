import { Injectable } from '@nestjs/common';
import { LedgerEntryType, PayoutStatus, Prisma } from '@resget/database';
import {
  PAYABLE_LINE_TYPES,
  addBusinessDays,
  orderShortCode,
  payoutBusinessDaysFor,
  payoutFee,
  previousPayoutDay,
  previousPayoutPeriod,
} from '@resget/shared';
import type {
  AdminPayoutDTO,
  AdminPayoutPageDTO,
  AdminPayoutQuery,
  FinanceLedgerDTO,
  LedgerEntryDTO,
  InstantPayoutQuoteDTO,
  PayoutCadence,
  PayoutDTO,
  PayoutRunReportDTO,
  PayoutScheduleDTO,
  PayoutScheduleOptionDTO,
  ScheduledCadence,
  UpsertPayoutScheduleOptionInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { EntitlementsService } from '../features/entitlements.service';
import { conflict, forbidden, notFound } from '../../common/api-error';

type PayoutScheduleOptionRow = Prisma.PayoutScheduleOptionGetPayload<object>;

interface FeeContext {
  option: PayoutScheduleOptionRow;
  hasFast: boolean;
}

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
  cadence: true,
  feeMinor: true,
  restaurant: { select: { id: true, name: true, slug: true } },
  _count: { select: { ledgerEntries: true } },
});
type PayoutRow = Prisma.PayoutGetPayload<{ select: typeof payoutSelect }>;

const payableTypes = [...PAYABLE_LINE_TYPES] as LedgerEntryType[];

/**
 * Payouts (docs/MUTABAKAT.md, docs/HAKEDIS_TAKVIMI.md): the payable lines
 * of a closed week, or of a closed day on the daily schedule, roll into one
 * payout per restaurant within the country's legal window; an instant
 * payout pays the balance on request. A faster payout's fee is a PAYOUT_FEE
 * line taken from it. Money moves by bank transfer today and the console marks
 * the payout sent, settled or failed; a payout provider adapter comes with
 * the PSP contract.
 */
@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly plans: EntitlementsService,
  ) {}

  /**
   * The daily roll: the closed week for restaurants paid weekly and the closed
   * day for restaurants paid daily (docs/HAKEDIS_TAKVIMI.md); idempotent per
   * restaurant, period, currency and cadence.
   */
  async rollDue(now: Date = new Date()): Promise<PayoutRunReportDTO> {
    const week = previousPayoutPeriod(now);
    const day = previousPayoutDay(now);
    // Every restaurant with unassigned payable money that closed before today.
    const groups = await this.prisma.ledgerEntry.groupBy({
      by: ['restaurantId', 'currency'],
      where: { payoutId: null, invoiceId: null, type: { in: payableTypes }, occurredAt: { lt: day.periodEnd } },
    });
    let created = 0;
    const totals = new Map<string, number>();
    for (const group of groups) {
      const restaurant = await this.prisma.restaurant.findUnique({
        where: { id: group.restaurantId },
        select: { id: true, countryCode: true, payoutCadence: true },
      });
      if (!restaurant) continue;
      const schedule = await this.effectiveSchedule(restaurant, group.currency);
      const period = schedule.cadence === 'DAILY' ? day : week;
      const exists = await this.prisma.payout.findFirst({
        where: {
          restaurantId: restaurant.id,
          periodStart: period.periodStart,
          currency: group.currency,
          cadence: schedule.cadence,
        },
        select: { id: true },
      });
      if (exists) continue;
      const payout = await this.prisma.$transaction((tx) =>
        this.createPayout(tx, {
          restaurantId: restaurant.id,
          currency: group.currency,
          cadence: schedule.cadence,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          scheduledFor: addBusinessDays(period.periodEnd, schedule.settleBusinessDays),
          fee: schedule.fee,
        }),
      );
      if (!payout) continue;
      created += 1;
      totals.set(group.currency, (totals.get(group.currency) ?? 0) + payout.amountMinor);
    }
    return {
      asOf: now.toISOString(),
      periodStart: week.periodStart.toISOString(),
      periodEnd: week.periodEnd.toISOString(),
      created,
      totals: [...totals.entries()].map(([currency, amountMinor]) => ({ currency, amountMinor })),
    };
  }

  // -- Payout schedules (docs/HAKEDIS_TAKVIMI.md) ----------------------------------------------

  async schedule(restaurantId: string): Promise<PayoutScheduleDTO> {
    const restaurant = await this.restaurantOf(restaurantId);
    const [enabled, hasFast, options, pending] = await Promise.all([
      this.features.isEnabled('payout_schedules', restaurantId),
      this.plans.has(restaurantId, 'fast_payouts'),
      this.prisma.payoutScheduleOption.findMany({
        where: { currency: restaurant.currency, isActive: true },
        orderBy: { cadence: 'asc' },
      }),
      this.pendingOf(restaurantId),
    ]);
    const cadence: ScheduledCadence = restaurant.payoutCadence === 'DAILY' ? 'DAILY' : 'WEEKLY';
    return {
      enabled,
      platformCollects: restaurant.paymentMode === 'PLATFORM_PSP',
      currency: restaurant.currency,
      cadence,
      options: options.map((o) => ({
        cadence: o.cadence,
        feeBps: o.feeBps,
        feeFixedMinor: o.feeFixedMinor,
        settleBusinessDays: o.settleBusinessDays,
        free: o.freeWithFastPayouts && hasFast,
        needsPlan: o.requiresFastPayouts && !hasFast,
      })),
      pendingPayableMinor: pending,
    };
  }

  async choose(restaurantId: string, cadence: ScheduledCadence, actorUserId: string): Promise<PayoutScheduleDTO> {
    const restaurant = await this.restaurantOf(restaurantId);
    if (restaurant.paymentMode !== 'PLATFORM_PSP')
      throw conflict('PAYOUT_SCHEDULE_UNAVAILABLE', 'Only a restaurant the platform collects for has payouts');
    if (cadence === 'DAILY') await this.usableOption(restaurant, 'DAILY');
    await this.prisma.$transaction([
      this.prisma.restaurant.update({ where: { id: restaurantId }, data: { payoutCadence: cadence } }),
      this.prisma.auditLog.create({
        data: {
          actorUserId,
          restaurantId,
          action: 'payout.schedule_chosen',
          entity: 'restaurant',
          entityId: restaurantId,
          meta: { cadence },
        },
      }),
    ]);
    return this.schedule(restaurantId);
  }

  async instantQuote(restaurantId: string): Promise<InstantPayoutQuoteDTO> {
    const restaurant = await this.restaurantOf(restaurantId);
    const option = await this.usableOption(restaurant, 'INSTANT');
    const amountMinor = await this.pendingOf(restaurantId);
    const feeMinor = payoutFee(amountMinor, option, await this.plans.has(restaurantId, 'fast_payouts'));
    return { amountMinor, feeMinor, netMinor: amountMinor - feeMinor, currency: restaurant.currency };
  }

  /**
   * Pays out every unassigned payable line now. The restaurant row is locked so two requests cannot pay the same
   * lines; the fee is taken from the payout as a PAYOUT_FEE line.
   */
  async instant(restaurantId: string, actorUserId: string, now: Date = new Date()): Promise<PayoutDTO> {
    const restaurant = await this.restaurantOf(restaurantId);
    if (restaurant.paymentMode !== 'PLATFORM_PSP')
      throw conflict('PAYOUT_SCHEDULE_UNAVAILABLE', 'Only a restaurant the platform collects for has payouts');
    const option = await this.usableOption(restaurant, 'INSTANT');
    const hasFast = await this.plans.has(restaurantId, 'fast_payouts');
    const payout = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM restaurants WHERE id = ${restaurantId} FOR UPDATE`;
      const first = await tx.ledgerEntry.findFirst({
        where: this.unassignedWhere(restaurantId, restaurant.currency, now),
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      });
      if (!first) throw conflict('PAYOUT_NOTHING_DUE', 'Nothing to pay out');
      const created = await this.createPayout(tx, {
        restaurantId,
        currency: restaurant.currency,
        cadence: 'INSTANT',
        periodStart: first.occurredAt,
        periodEnd: now,
        scheduledFor: addBusinessDays(now, option.settleBusinessDays),
        fee: { option, hasFast },
        requirePositiveNet: true,
      });
      if (!created) throw conflict('PAYOUT_NOTHING_DUE', 'Nothing to pay out after the fee');
      await tx.auditLog.create({
        data: {
          actorUserId,
          restaurantId,
          action: 'payout.instant_requested',
          entity: 'payout',
          entityId: created.id,
          meta: { amountMinor: created.amountMinor, feeMinor: created.feeMinor },
        },
      });
      return created;
    });
    return this.toDto(await this.require(payout.id));
  }

  // -- Console: options ------------------------------------------------------------------------

  async options(): Promise<PayoutScheduleOptionDTO[]> {
    const rows = await this.prisma.payoutScheduleOption.findMany({
      orderBy: [{ currency: 'asc' }, { cadence: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      cadence: r.cadence,
      currency: r.currency,
      feeBps: r.feeBps,
      feeFixedMinor: r.feeFixedMinor,
      settleBusinessDays: r.settleBusinessDays,
      requiresFastPayouts: r.requiresFastPayouts,
      freeWithFastPayouts: r.freeWithFastPayouts,
      isActive: r.isActive,
    }));
  }

  async upsertOption(actorUserId: string, input: UpsertPayoutScheduleOptionInput): Promise<PayoutScheduleOptionDTO[]> {
    const { cadence, currency, ...rest } = input;
    const row = await this.prisma.payoutScheduleOption.upsert({
      where: { cadence_currency: { cadence, currency } },
      create: { cadence, currency, ...rest },
      update: rest,
      select: { id: true },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'payout.option_saved',
        entity: 'payout_schedule_option',
        entityId: row.id,
        meta: { ...input },
      },
    });
    return this.options();
  }

  // -- Schedule internals ----------------------------------------------------------------------

  /**
   * How a restaurant is paid in a currency right now: its chosen schedule when the module is on and the option is
   * on sale and allowed on its plan, weekly otherwise. Weekly without an option row keeps the original rule.
   */
  private async effectiveSchedule(
    restaurant: { id: string; countryCode: string; payoutCadence: PayoutCadence },
    currency: string,
  ): Promise<{ cadence: 'WEEKLY' | 'DAILY'; settleBusinessDays: number; fee: FeeContext | null }> {
    const enabled = await this.features.isEnabled('payout_schedules', restaurant.id);
    const hasFast = enabled ? await this.plans.has(restaurant.id, 'fast_payouts') : false;
    if (enabled && restaurant.payoutCadence === 'DAILY') {
      const daily = await this.prisma.payoutScheduleOption.findUnique({
        where: { cadence_currency: { cadence: 'DAILY', currency } },
      });
      if (daily && daily.isActive && (!daily.requiresFastPayouts || hasFast)) {
        return { cadence: 'DAILY', settleBusinessDays: daily.settleBusinessDays, fee: { option: daily, hasFast } };
      }
    }
    const weekly = enabled
      ? await this.prisma.payoutScheduleOption.findUnique({
          where: { cadence_currency: { cadence: 'WEEKLY', currency } },
        })
      : null;
    if (weekly && weekly.isActive) {
      return { cadence: 'WEEKLY', settleBusinessDays: weekly.settleBusinessDays, fee: { option: weekly, hasFast } };
    }
    return { cadence: 'WEEKLY', settleBusinessDays: payoutBusinessDaysFor(restaurant.countryCode), fee: null };
  }

  /** The option for a cadence when the module is on, it is on sale in the restaurant's currency and its plan allows it. */
  private async usableOption(
    restaurant: { id: string; currency: string },
    cadence: PayoutCadence,
  ): Promise<PayoutScheduleOptionRow> {
    await this.features.assertEnabled('payout_schedules', restaurant.id);
    const option = await this.prisma.payoutScheduleOption.findUnique({
      where: { cadence_currency: { cadence, currency: restaurant.currency } },
    });
    if (!option || !option.isActive)
      throw conflict('PAYOUT_SCHEDULE_UNAVAILABLE', `No ${cadence} payouts in ${restaurant.currency}`);
    if (option.requiresFastPayouts && !(await this.plans.has(restaurant.id, 'fast_payouts')))
      throw forbidden('PLAN_FEATURE_REQUIRED', 'Faster payouts are not in the restaurant plan');
    return option;
  }

  private unassignedWhere(restaurantId: string, currency: string, before: Date): Prisma.LedgerEntryWhereInput {
    return {
      restaurantId,
      currency,
      payoutId: null,
      invoiceId: null,
      type: { in: payableTypes },
      occurredAt: { lt: before },
    };
  }

  /**
   * One payout from the unassigned payable lines before the period end, with its fee taken as a PAYOUT_FEE line.
   * Null when there is nothing to pay (or, when asked, nothing left after the fee).
   */
  private async createPayout(
    tx: Prisma.TransactionClient,
    input: {
      restaurantId: string;
      currency: string;
      cadence: PayoutCadence;
      periodStart: Date;
      periodEnd: Date;
      scheduledFor: Date;
      fee: FeeContext | null;
      requirePositiveNet?: boolean;
    },
  ): Promise<{ id: string; amountMinor: number; feeMinor: number } | null> {
    const where = this.unassignedWhere(input.restaurantId, input.currency, input.periodEnd);
    const sum = await tx.ledgerEntry.aggregate({ where, _sum: { amountMinor: true }, _count: { _all: true } });
    if (sum._count._all === 0) return null;
    const grossMinor = sum._sum.amountMinor ?? 0;
    const feeMinor = input.fee ? payoutFee(grossMinor, input.fee.option, input.fee.hasFast) : 0;
    if (input.requirePositiveNet && grossMinor - feeMinor <= 0) return null;
    const payout = await tx.payout.create({
      data: {
        restaurantId: input.restaurantId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        amountMinor: grossMinor - feeMinor,
        currency: input.currency,
        cadence: input.cadence,
        feeMinor,
        scheduledFor: input.scheduledFor,
      },
      select: { id: true },
    });
    await tx.ledgerEntry.updateMany({ where, data: { payoutId: payout.id } });
    if (feeMinor > 0) {
      await tx.ledgerEntry.create({
        data: {
          restaurantId: input.restaurantId,
          payoutId: payout.id,
          type: LedgerEntryType.PAYOUT_FEE,
          amountMinor: -feeMinor,
          currency: input.currency,
          occurredAt: new Date(),
          memo: `payout fee ${input.cadence.toLowerCase()}`,
        },
      });
    }
    return { id: payout.id, amountMinor: grossMinor - feeMinor, feeMinor };
  }

  private async restaurantOf(restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, currency: true, countryCode: true, paymentMode: true, payoutCadence: true },
    });
    if (!restaurant) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
    return restaurant;
  }

  private async pendingOf(restaurantId: string): Promise<number> {
    const pending = await this.prisma.ledgerEntry.aggregate({
      where: { restaurantId, payoutId: null, invoiceId: null, type: { in: payableTypes } },
      _sum: { amountMinor: true },
    });
    return pending._sum.amountMinor ?? 0;
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
      cadence: row.cadence,
      feeMinor: row.feeMinor,
    };
  }

  private toAdminDto(row: PayoutRow): AdminPayoutDTO {
    return { ...this.toDto(row), restaurant: row.restaurant };
  }
}
