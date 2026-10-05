import { Injectable } from '@nestjs/common';
import {
  ACCOUNTING_LINE_COLUMNS,
  ACCOUNTING_ORDER_COLUMNS,
  accountingAmount,
  accountingCsv,
  bpsPercentText,
  commissionPeriod,
  localDateTimeText,
  orderShortCode,
} from '@resget/shared';
import type { AccountingCell, AccountingPeriod } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Snapshot entries are { name, priceDeltaMinor }; anything else is skipped. */
function optionNames(snapshot: unknown): string {
  if (!Array.isArray(snapshot)) return '';
  return snapshot
    .map((entry: unknown) =>
      entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string' ? entry.name : null,
    )
    .filter((name): name is string => name !== null)
    .join('; ');
}

/**
 * A month of orders for the accountant (docs/MUHASEBE_AKTARIMI.md). Orders
 * still waiting for an online payment never happened and are left out;
 * every other order of the month is listed with its status, so cancelled
 * and refunded ones can be matched against the payment provider's report.
 */
@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  private async scope(restaurantId: string, period: AccountingPeriod) {
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { timezone: true },
    });
    const { periodStart, periodEnd } = commissionPeriod(period.year, period.month);
    return {
      timezone: restaurant.timezone,
      where: {
        restaurantId,
        placedAt: { gte: periodStart, lt: periodEnd },
        status: { not: 'PENDING_PAYMENT' as const },
      },
    };
  }

  async ordersCsv(restaurantId: string, period: AccountingPeriod): Promise<string> {
    const { timezone, where } = await this.scope(restaurantId, period);
    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { placedAt: 'asc' },
      include: { refunds: { select: { amountMinor: true } } },
    });
    const rows: AccountingCell[][] = orders.map((o) => {
      const money = (minor: number) => accountingAmount(minor, o.currency);
      const refunded = o.refunds.reduce((sum, r) => sum + r.amountMinor, 0);
      return [
        orderShortCode(o.id),
        o.id,
        o.placedAt.toISOString(),
        localDateTimeText(o.placedAt, timezone),
        o.completedAt ? localDateTimeText(o.completedAt, timezone) : null,
        o.status,
        o.channel,
        o.fulfillment,
        o.paymentMethod,
        o.paymentProvider,
        o.paymentMode,
        o.currency,
        money(o.itemsGrossMinor),
        money(o.itemsVatMinor),
        money(o.itemsGrossMinor - o.itemsVatMinor),
        money(o.deliveryFeeMinor),
        money(o.discountMinor),
        o.discountFundedBy,
        money(o.chargedToCustomerMinor),
        money(refunded),
        bpsPercentText(o.commissionBps),
        money(o.platformCommissionMinor),
        money(o.commissionVatMinor),
        money(o.pspFeeMinor),
        o.pspFeeBearer,
        money(o.withholdingMinor),
        money(o.courierCostMinor),
        o.courierBearer,
        money(o.restaurantPayableMinor),
        money(o.platformReceivableMinor),
      ];
    });
    return accountingCsv(ACCOUNTING_ORDER_COLUMNS, rows);
  }

  async linesCsv(restaurantId: string, period: AccountingPeriod): Promise<string> {
    const { timezone, where } = await this.scope(restaurantId, period);
    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { placedAt: 'asc' },
      select: {
        id: true,
        placedAt: true,
        status: true,
        currency: true,
        items: {
          orderBy: { position: 'asc' },
          select: {
            nameSnapshot: true,
            modifiersSnapshot: true,
            quantity: true,
            unitPriceMinor: true,
            vatRateBps: true,
            lineTotalMinor: true,
          },
        },
      },
    });
    const rows: AccountingCell[][] = orders.flatMap((o) =>
      o.items.map((item) => [
        orderShortCode(o.id),
        localDateTimeText(o.placedAt, timezone),
        o.status,
        item.nameSnapshot,
        optionNames(item.modifiersSnapshot),
        item.quantity,
        accountingAmount(item.unitPriceMinor, o.currency),
        bpsPercentText(item.vatRateBps),
        accountingAmount(item.lineTotalMinor, o.currency),
        o.currency,
      ]),
    );
    return accountingCsv(ACCOUNTING_LINE_COLUMNS, rows);
  }
}
