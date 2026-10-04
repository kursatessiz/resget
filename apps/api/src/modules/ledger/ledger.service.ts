import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { orderLedgerLines, orderShortCode } from '@resget/shared';
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
    const booked = await db.ledgerEntry.count({ where: { orderId, type: 'REFUND' } });
    if (booked > 0) return;
    await db.ledgerEntry.create({
      data: {
        restaurantId: order.restaurantId,
        orderId: order.id,
        type: 'REFUND',
        amountMinor: -amountMinor,
        currency: order.currency,
        occurredAt: now,
        memo: `refund ${orderShortCode(order.id)}`,
      },
    });
  }
}
