import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { commissionReversalLines, orderLedgerLines, orderShortCode } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

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
   * A chargeback on platform-collected money (docs/MUTABAKAT.md, "İade ve
   * chargeback"): by contract the restaurant bears it, so the amount the
   * cardholder's bank took back comes out of the next payout, like a
   * refund. Only an order that credited the restaurant (completed) has
   * anything to take back, and never twice (a refund or an earlier
   * chargeback already did).
   */
  async recordChargeback(db: Db, orderId: string, amountMinor: number, now: Date = new Date()): Promise<boolean> {
    if (amountMinor <= 0) return false;
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, restaurantId: true, currency: true, paymentMode: true },
    });
    if (!order || order.paymentMode !== 'PLATFORM_PSP') return false;
    const credited = await db.ledgerEntry.count({ where: { orderId, type: 'RESTAURANT_PAYABLE' } });
    if (credited === 0) return false;
    const booked = await db.ledgerEntry.count({ where: { orderId, type: { in: ['REFUND', 'CHARGEBACK'] } } });
    if (booked > 0) return false;
    await this.takeBack(db, order, 'CHARGEBACK', amountMinor, now, `chargeback ${orderShortCode(order.id)}`);
    return true;
  }

  /**
   * A refund after completion: one negative line, so the next payout carries
   * it. An order refunded before it completed never credited the restaurant
   * (its lines are written on completion), so nothing is taken back.
   */
  async recordRefund(db: Db, orderId: string, amountMinor: number, now: Date = new Date()): Promise<void> {
    if (amountMinor <= 0) return;
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, restaurantId: true, currency: true, paymentMode: true },
    });
    if (!order || order.paymentMode !== 'PLATFORM_PSP') return;
    const credited = await db.ledgerEntry.count({ where: { orderId, type: 'RESTAURANT_PAYABLE' } });
    if (credited === 0) return;
    // Money already taken back (a refund or a chargeback) is never taken twice.
    const booked = await db.ledgerEntry.count({ where: { orderId, type: { in: ['REFUND', 'CHARGEBACK'] } } });
    if (booked > 0) return;
    await this.takeBack(db, order, 'REFUND', amountMinor, now, `refund ${orderShortCode(order.id)}`);
  }

  /**
   * The restaurant bears the refund or chargeback (the amount comes out of the
   * next payout) and the platform takes no commission on the order: its
   * commission and VAT come back in the same payout (docs/MUTABAKAT.md).
   */
  private async takeBack(
    db: Db,
    order: { id: string; restaurantId: string; currency: string },
    type: 'REFUND' | 'CHARGEBACK',
    amountMinor: number,
    now: Date,
    memo: string,
  ): Promise<void> {
    const snapshot = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { platformCommissionMinor: true, commissionVatMinor: true },
    });
    const base = { restaurantId: order.restaurantId, orderId: order.id, currency: order.currency, occurredAt: now };
    await db.ledgerEntry.createMany({
      data: [
        { ...base, type, amountMinor: -amountMinor, memo },
        ...commissionReversalLines(snapshot).map((line) => ({ ...base, ...line, memo: `${memo} commission returned` })),
      ],
    });
  }
}
