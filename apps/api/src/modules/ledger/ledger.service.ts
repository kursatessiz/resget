import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@resget/database';
import {
  commissionReversalLines,
  orderLedgerLines,
  orderShortCode,
  refundableMinor,
  refundCommissionShare,
} from '@resget/shared';
import type { OrderRefundSourceValue, RefundCommissionShare, RefundItem } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/** One refund of one payment, as the refund paths hand it over. */
export interface RefundRecord {
  orderId: string;
  paymentId: string | null;
  source: OrderRefundSourceValue;
  amountMinor: number;
  /** The items this refund gave back, when it was for items. */
  items?: RefundItem[] | null;
  reason?: string | null;
  actorUserId?: string | null;
  now: Date;
}

/**
 * The append-only ledger (docs/MUTABAKAT.md). Only orders whose money went
 * through the platform (PLATFORM_PSP) get per-order lines; an OWN_POS order
 * is settled by the restaurant's own bank and its commission is booked by
 * the monthly invoice. Writing is idempotent per order.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Writes the statement of a completed order once; returns how many lines were written. */
  async recordOrderCompletion(db: Db, orderId: string, now: Date = new Date()): Promise<number> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        restaurantId: true,
        currency: true,
        paymentMode: true,
        itemsGrossMinor: true,
        discountMinor: true,
        discountFundedBy: true,
        deliveryFeeMinor: true,
        courierCostMinor: true,
        courierBearer: true,
        platformCommissionMinor: true,
        commissionVatMinor: true,
        pspFeeMinor: true,
        withholdingMinor: true,
        restaurantPayableMinor: true,
      },
    });
    if (!order || order.paymentMode !== 'PLATFORM_PSP') return 0;
    const existing = await db.ledgerEntry.count({ where: { orderId } });
    if (existing > 0) return 0;
    const lines = orderLedgerLines(order);
    if (lines.some((l) => l.type === 'ADJUSTMENT')) {
      this.logger.warn(
        `order ${orderId} ledger lines did not add up to the snapshot; an adjustment line closes the gap`,
      );
    }
    const memo = `order ${orderShortCode(order.id)}`;
    await db.ledgerEntry.createMany({
      data: lines.map((line) => ({
        restaurantId: order.restaurantId,
        orderId: order.id,
        type: line.type,
        amountMinor: line.amountMinor,
        currency: order.currency,
        occurredAt: now,
        memo,
      })),
    });
    return lines.length;
  }

  /**
   * Books one refund of one payment (docs/ODEME.md "İade", docs/MUTABAKAT.md
   * "Kısmi iade"), in the transaction that raised the payment's refunded
   * amount: an OrderRefund row with the share of the order's commission the
   * platform gives back (refundCommissionShare: the refunded share of what
   * the customer paid, the rest with the last refund or a chargeback), and,
   * for platform-collected money of a completed order, the ledger lines that
   * take the amount out of the next payout and give the commission share
   * back in it. The restaurant bears every refund and chargeback by
   * contract. Once nothing is left, the whole commission is cancelled and
   * the order is stamped (commissionReversedAt): an uninvoiced order then
   * leaves the month's invoice. Call it after the payment row is updated.
   */
  async recordRefund(db: Db, record: RefundRecord): Promise<RefundCommissionShare> {
    if (record.amountMinor <= 0) return { commissionMinor: 0, commissionVatMinor: 0 };
    const order = await db.order.findUniqueOrThrow({
      where: { id: record.orderId },
      select: {
        id: true,
        restaurantId: true,
        currency: true,
        paymentMode: true,
        completedAt: true,
        commissionReversedAt: true,
        platformCommissionMinor: true,
        commissionVatMinor: true,
        chargedToCustomerMinor: true,
        payments: { select: { status: true, amountMinor: true, refundedMinor: true } },
        refunds: { select: { amountMinor: true, commissionMinor: true, commissionVatMinor: true } },
      },
    });
    const final = record.source === 'CHARGEBACK' || order.payments.every((p) => refundableMinor(p) === 0);
    const share = refundCommissionShare(
      {
        completed: order.completedAt !== null,
        platformCommissionMinor: order.platformCommissionMinor,
        commissionVatMinor: order.commissionVatMinor,
        chargedToCustomerMinor: order.chargedToCustomerMinor,
      },
      order.refunds,
      record.amountMinor,
      final,
    );
    await db.orderRefund.create({
      data: {
        restaurantId: order.restaurantId,
        orderId: order.id,
        paymentId: record.paymentId,
        source: record.source,
        amountMinor: record.amountMinor,
        currency: order.currency,
        commissionMinor: share.commissionMinor,
        commissionVatMinor: share.commissionVatMinor,
        items: record.items && record.items.length > 0 ? record.items : Prisma.JsonNull,
        reason: record.reason ?? null,
        createdByUserId: record.actorUserId ?? null,
        createdAt: record.now,
      },
    });
    if (final && order.completedAt && !order.commissionReversedAt) {
      await db.order.update({ where: { id: order.id }, data: { commissionReversedAt: record.now } });
    }
    if (order.paymentMode !== 'PLATFORM_PSP') return share;
    // An order refunded before it completed never credited the restaurant (its lines come on completion).
    const credited = await db.ledgerEntry.count({ where: { orderId: order.id, type: 'RESTAURANT_PAYABLE' } });
    if (credited === 0) return share;
    const type = record.source === 'CHARGEBACK' ? 'CHARGEBACK' : 'REFUND';
    const memo = `${type === 'CHARGEBACK' ? 'chargeback' : 'refund'} ${orderShortCode(order.id)}`;
    const base = {
      restaurantId: order.restaurantId,
      orderId: order.id,
      currency: order.currency,
      occurredAt: record.now,
    };
    await db.ledgerEntry.createMany({
      data: [
        { ...base, type, amountMinor: -record.amountMinor, memo },
        ...commissionReversalLines({
          platformCommissionMinor: share.commissionMinor,
          commissionVatMinor: share.commissionVatMinor,
        }).map((line) => ({ ...base, ...line, memo: `${memo} commission returned` })),
      ],
    });
    return share;
  }
}
