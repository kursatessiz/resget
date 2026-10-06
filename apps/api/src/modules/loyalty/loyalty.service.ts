import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import {
  LOYALTY_PROGRAM_DEFAULTS,
  balanceValueMinor,
  minorDigitsOf,
  orderShortCode,
  pointsEarnedFor,
  redeemableFor,
} from '@resget/shared';
import type {
  AdjustLoyaltyInput,
  CustomerLoyaltyDTO,
  LoyaltyBalanceDTO,
  LoyaltyOverviewDTO,
  LoyaltyProgram,
  LoyaltyProgramDTO,
  LoyaltyRedemption,
  LoyaltyTransactionDTO,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService, subscriptionForPlanSelect, subscriptionLike } from '../features/entitlements.service';
import { conflict, notFound } from '../../common/api-error';

type Db = Prisma.TransactionClient | PrismaService;

const subscriptionSelect = { select: subscriptionForPlanSelect } as const;

const programSelect = {
  id: true,
  currency: true,
  loyaltyProgram: true,
  subscription: subscriptionSelect,
} as const;
type ProgramRow = Prisma.RestaurantGetPayload<{ select: typeof programSelect }>;

const transactionSelect = {
  id: true,
  type: true,
  points: true,
  balanceAfter: true,
  orderId: true,
  memo: true,
  createdAt: true,
  customer: { select: { id: true, user: { select: { fullName: true } } } },
} as const;
type TransactionRow = Prisma.LoyaltyTransactionGetPayload<{ select: typeof transactionSelect }>;

interface ResolvedProgram {
  program: LoyaltyProgram;
  currency: string;
  /** Enabled and the plan carries the `loyalty` feature. */
  active: boolean;
  /** No row yet: the defaults the screen offers. */
  stored: boolean;
}

/** Statuses in which an order's loyalty discount counts as given. */
const COMPLETED = ['DELIVERED', 'PICKED_UP'] as const;

/**
 * Loyalty program (docs/SADAKAT.md). Points are integers on the customer row;
 * every movement is an append-only transaction, written inside the order's
 * own transaction so a failed order never leaves a dangling earn or spend.
 */
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: EntitlementsService,
  ) {}

  // -- Program -----------------------------------------------------------------------------

  async resolve(db: Db, restaurantId: string): Promise<ResolvedProgram> {
    const row = await db.restaurant.findUnique({ where: { id: restaurantId }, select: programSelect });
    if (!row) throw notFound('NOT_FOUND', 'Restaurant not found');
    return this.resolveRow(row);
  }

  private async resolveRow(row: ProgramRow): Promise<ResolvedProgram> {
    const unit = 10 ** minorDigitsOf(row.currency);
    const program: LoyaltyProgram = row.loyaltyProgram
      ? {
          enabled: row.loyaltyProgram.enabled,
          earnPoints: row.loyaltyProgram.earnPoints,
          earnStepMinor: row.loyaltyProgram.earnStepMinor,
          redeemPoints: row.loyaltyProgram.redeemPoints,
          redeemValueMinor: row.loyaltyProgram.redeemValueMinor,
          minOrderMinor: row.loyaltyProgram.minOrderMinor,
          maxDiscountBps: row.loyaltyProgram.maxDiscountBps,
          welcomePoints: row.loyaltyProgram.welcomePoints,
          notifyEarned: row.loyaltyProgram.notifyEarned,
        }
      : {
          ...LOYALTY_PROGRAM_DEFAULTS,
          // One point per currency unit spent, one hundred points buy ten units back.
          earnStepMinor: unit,
          redeemValueMinor: 10 * unit,
          minOrderMinor: 0,
        };
    const { entitlements } = await this.plans.resolveFor(row.id, subscriptionLike(row.subscription));
    return {
      program,
      currency: row.currency,
      active: program.enabled && entitlements.has('loyalty'),
      stored: row.loyaltyProgram !== null,
    };
  }

  async overview(restaurantId: string): Promise<LoyaltyOverviewDTO> {
    const resolved = await this.resolve(this.prisma, restaurantId);
    const [members, outstanding, earned, redeemed, discount, recent] = await Promise.all([
      this.prisma.restaurantCustomer.count({ where: { restaurantId, loyaltyPoints: { gt: 0 } } }),
      this.prisma.restaurantCustomer.aggregate({ where: { restaurantId }, _sum: { loyaltyPoints: true } }),
      this.prisma.loyaltyTransaction.aggregate({
        where: { restaurantId, type: { in: ['EARN', 'WELCOME'] } },
        _sum: { points: true },
      }),
      this.prisma.loyaltyTransaction.aggregate({ where: { restaurantId, type: 'REDEEM' }, _sum: { points: true } }),
      this.prisma.order.aggregate({
        where: { restaurantId, status: { in: [...COMPLETED] }, loyaltyTransactions: { some: { type: 'REDEEM' } } },
        _sum: { discountMinor: true },
      }),
      this.prisma.loyaltyTransaction.findMany({
        where: { restaurantId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: transactionSelect,
      }),
    ]);
    return {
      program: this.toProgramDto(resolved),
      stats: {
        members,
        pointsOutstanding: outstanding._sum.loyaltyPoints ?? 0,
        pointsEarned: earned._sum.points ?? 0,
        pointsRedeemed: -(redeemed._sum.points ?? 0),
        discountGivenMinor: discount._sum.discountMinor ?? 0,
        currency: resolved.currency,
      },
      recent: recent.map((row) => this.toTransactionDto(row, true)),
    };
  }

  async updateProgram(restaurantId: string, input: LoyaltyProgram, actorUserId: string): Promise<LoyaltyProgramDTO> {
    await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyProgram.upsert({
        where: { restaurantId },
        update: input,
        create: { restaurantId, ...input },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          restaurantId,
          action: 'loyalty.program.update',
          entity: 'loyalty_program',
          entityId: restaurantId,
          meta: input,
        },
      });
    });
    return this.toProgramDto(await this.resolve(this.prisma, restaurantId));
  }

  private toProgramDto(resolved: ResolvedProgram): LoyaltyProgramDTO {
    return { ...resolved.program, currency: resolved.currency, active: resolved.active };
  }

  // -- Storefront and account ----------------------------------------------------------------

  /** The rules a storefront shows; null when the restaurant has no active program. */
  async storefrontRules(restaurantId: string): Promise<LoyaltyOverviewDTO['program'] | null> {
    const resolved = await this.resolve(this.prisma, restaurantId);
    return resolved.active ? this.toProgramDto(resolved) : null;
  }

  /** The signed-in visitor's balance at one restaurant; null without an active program. */
  async balanceOf(restaurantId: string, userId: string): Promise<number | null> {
    const resolved = await this.resolve(this.prisma, restaurantId);
    if (!resolved.active) return null;
    const customer = await this.prisma.restaurantCustomer.findUnique({
      where: { restaurantId_userId: { restaurantId, userId } },
      select: { loyaltyPoints: true },
    });
    return customer?.loyaltyPoints ?? 0;
  }

  /** Every restaurant where the person holds points, with what the balance buys today. */
  async balancesOf(userId: string): Promise<LoyaltyBalanceDTO[]> {
    const rows = await this.prisma.restaurantCustomer.findMany({
      where: { userId, loyaltyPoints: { gt: 0 } },
      orderBy: { loyaltyPoints: 'desc' },
      select: {
        loyaltyPoints: true,
        restaurant: { select: { ...programSelect, name: true, slug: true, logoUrl: true } },
      },
    });
    return Promise.all(
      rows.map(async (row) => {
        const resolved = await this.resolveRow(row.restaurant);
        return {
          restaurant: { name: row.restaurant.name, slug: row.restaurant.slug, logoUrl: row.restaurant.logoUrl },
          points: row.loyaltyPoints,
          valueMinor: resolved.active ? balanceValueMinor(resolved.program, row.loyaltyPoints) : 0,
          currency: resolved.currency,
        };
      }),
    );
  }

  // -- Order hooks --------------------------------------------------------------------------

  /**
   * What a signed-in customer may spend on an order about to be placed. The
   * balance is checked again when the points are taken inside the order's
   * transaction, so two tabs cannot spend the same points twice.
   */
  async prepareRedemption(
    db: Db,
    restaurantId: string,
    userId: string,
    itemsGrossMinor: number,
  ): Promise<LoyaltyRedemption & { customerId: string }> {
    const resolved = await this.resolve(db, restaurantId);
    if (!resolved.active) throw conflict('LOYALTY_NOT_ACTIVE', 'No active loyalty program');
    const customer = await db.restaurantCustomer.findUnique({
      where: { restaurantId_userId: { restaurantId, userId } },
      select: { id: true, loyaltyPoints: true },
    });
    const redemption = redeemableFor(resolved.program, customer?.loyaltyPoints ?? 0, itemsGrossMinor);
    if (!customer || redemption.points === 0) throw conflict('LOYALTY_NOT_REDEEMABLE', 'Nothing to redeem');
    return { ...redemption, customerId: customer.id };
  }

  /** Takes the points for an order that was just created; refuses when the balance moved underneath. */
  async applyRedemption(
    tx: Prisma.TransactionClient,
    restaurantId: string,
    customerId: string,
    orderId: string,
    points: number,
  ): Promise<void> {
    const taken = await tx.restaurantCustomer.updateMany({
      where: { id: customerId, restaurantId, loyaltyPoints: { gte: points } },
      data: { loyaltyPoints: { decrement: points } },
    });
    if (taken.count !== 1) throw conflict('LOYALTY_NOT_REDEEMABLE', 'Balance changed');
    const after = await tx.restaurantCustomer.findUniqueOrThrow({
      where: { id: customerId },
      select: { loyaltyPoints: true },
    });
    await tx.loyaltyTransaction.create({
      data: {
        restaurantId,
        customerId,
        orderId,
        type: 'REDEEM',
        points: -points,
        balanceAfter: after.loyaltyPoints,
        memo: `order ${orderShortCode(orderId)}`,
      },
    });
  }

  /** Points this order spent, for the placement receipt. */
  async redeemedPointsOf(orderId: string): Promise<number> {
    const row = await this.prisma.loyaltyTransaction.findFirst({
      where: { orderId, type: 'REDEEM' },
      select: { points: true },
    });
    return row ? -row.points : 0;
  }

  /** A completed order earns on its items spend after the loyalty discount; the first one also pays the welcome bonus. Idempotent. */
  async recordCompletion(tx: Prisma.TransactionClient, orderId: string, now: Date = new Date()): Promise<number> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, restaurantId: true, customerUserId: true, itemsGrossMinor: true, discountMinor: true },
    });
    if (!order || !order.customerUserId) return 0;
    const resolved = await this.resolve(tx, order.restaurantId);
    if (!resolved.active) return 0;
    const earnedBefore = await tx.loyaltyTransaction.count({ where: { orderId, type: { in: ['EARN', 'WELCOME'] } } });
    if (earnedBefore > 0) return 0;
    const customer = await tx.restaurantCustomer.findUnique({
      where: { restaurantId_userId: { restaurantId: order.restaurantId, userId: order.customerUserId } },
      select: { id: true, loyaltyPoints: true, loyaltyJoinedAt: true },
    });
    if (!customer) return 0;
    const earned = pointsEarnedFor(resolved.program, order.itemsGrossMinor - order.discountMinor);
    const welcome = customer.loyaltyJoinedAt ? 0 : resolved.program.welcomePoints;
    if (earned === 0 && welcome === 0) return 0;
    let balance = customer.loyaltyPoints;
    const rows: Prisma.LoyaltyTransactionCreateManyInput[] = [];
    if (welcome > 0) {
      balance += welcome;
      rows.push({
        restaurantId: order.restaurantId,
        customerId: customer.id,
        orderId,
        type: 'WELCOME',
        points: welcome,
        balanceAfter: balance,
        createdAt: now,
      });
    }
    if (earned > 0) {
      balance += earned;
      rows.push({
        restaurantId: order.restaurantId,
        customerId: customer.id,
        orderId,
        type: 'EARN',
        points: earned,
        balanceAfter: balance,
        memo: `order ${orderShortCode(orderId)}`,
        // One millisecond after the welcome row so the history reads in the order the balance moved.
        createdAt: welcome > 0 ? new Date(now.getTime() + 1) : now,
      });
    }
    await tx.loyaltyTransaction.createMany({ data: rows });
    await tx.restaurantCustomer.update({
      where: { id: customer.id },
      data: { loyaltyPoints: balance, loyaltyJoinedAt: customer.loyaltyJoinedAt ?? now },
    });
    return earned + welcome;
  }

  /**
   * A cancelled, rejected or refunded order gives spent points back and takes
   * earned ones away (never below zero). One reversal per order.
   */
  async recordReversal(tx: Prisma.TransactionClient, orderId: string, now: Date = new Date()): Promise<number> {
    const movements = await tx.loyaltyTransaction.findMany({
      where: { orderId },
      select: { type: true, points: true, customerId: true, restaurantId: true },
    });
    if (movements.length === 0 || movements.some((m) => m.type === 'REVERSAL')) return 0;
    const spent = -movements.filter((m) => m.type === 'REDEEM').reduce((sum, m) => sum + m.points, 0);
    const earned = movements
      .filter((m) => m.type === 'EARN' || m.type === 'WELCOME')
      .reduce((sum, m) => sum + m.points, 0);
    const { customerId, restaurantId } = movements[0];
    const customer = await tx.restaurantCustomer.findUniqueOrThrow({
      where: { id: customerId },
      select: { loyaltyPoints: true },
    });
    const delta = spent - Math.min(earned, customer.loyaltyPoints + spent);
    const balance = customer.loyaltyPoints + delta;
    await tx.restaurantCustomer.update({ where: { id: customerId }, data: { loyaltyPoints: balance } });
    await tx.loyaltyTransaction.create({
      data: {
        restaurantId,
        customerId,
        orderId,
        type: 'REVERSAL',
        points: delta,
        balanceAfter: balance,
        memo: `order ${orderShortCode(orderId)}`,
        createdAt: now,
      },
    });
    return delta;
  }

  // -- Customer card ------------------------------------------------------------------------

  async customerHistory(restaurantId: string, customerId: string): Promise<CustomerLoyaltyDTO> {
    const customer = await this.prisma.restaurantCustomer.findFirst({
      where: { id: customerId, restaurantId },
      select: { loyaltyPoints: true },
    });
    if (!customer) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
    const rows = await this.prisma.loyaltyTransaction.findMany({
      where: { customerId, restaurantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: transactionSelect,
    });
    return { points: customer.loyaltyPoints, transactions: rows.map((row) => this.toTransactionDto(row, false)) };
  }

  /** A manual correction by staff: a goodwill gesture or a fix; never below zero. */
  async adjust(
    restaurantId: string,
    customerId: string,
    input: AdjustLoyaltyInput,
    actorUserId: string,
  ): Promise<CustomerLoyaltyDTO> {
    await this.prisma.$transaction(async (tx) => {
      const customer = await tx.restaurantCustomer.findFirst({
        where: { id: customerId, restaurantId },
        select: { id: true, loyaltyPoints: true },
      });
      if (!customer) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
      const balance = customer.loyaltyPoints + input.points;
      if (balance < 0) throw conflict('LOYALTY_INSUFFICIENT_POINTS', 'Balance would go negative');
      await tx.restaurantCustomer.update({ where: { id: customer.id }, data: { loyaltyPoints: balance } });
      await tx.loyaltyTransaction.create({
        data: {
          restaurantId,
          customerId,
          type: 'ADJUSTMENT',
          points: input.points,
          balanceAfter: balance,
          memo: input.memo,
          createdByUserId: actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          restaurantId,
          action: 'loyalty.adjust',
          entity: 'restaurant_customer',
          entityId: customerId,
          meta: { points: input.points, memo: input.memo },
        },
      });
    });
    return this.customerHistory(restaurantId, customerId);
  }

  private toTransactionDto(row: TransactionRow, withCustomer: boolean): LoyaltyTransactionDTO {
    return {
      id: row.id,
      type: row.type,
      points: row.points,
      balanceAfter: row.balanceAfter,
      orderShortCode: row.orderId ? orderShortCode(row.orderId) : null,
      memo: row.memo,
      customer: withCustomer ? { id: row.customer.id, fullName: row.customer.user.fullName } : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
