import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { REFERRAL_CAP_WINDOW_DAYS, friendCouponTerms, referralCodeFrom } from '@resget/shared';
import type { CouponKind, MyReferralDTO, ReferralProgramDTO, UpsertReferralProgramInput } from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { conflict, notFound } from '../../common/api-error';
import { CouponsService } from './coupons.service';

type ProgramRow = Prisma.ReferralProgramGetPayload<object>;
const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_ATTEMPTS = 5;

/**
 * Customer referrals (docs/TAVSIYE.md). A personal code is a coupon of
 * source REFERRAL carrying the programme's friend terms (first order only,
 * once per phone); the referrer's reward is a REFERRAL_REWARD coupon only
 * they can use, issued in the transaction that completes the friend's order.
 */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly coupons: CouponsService,
  ) {}

  // -- Panel ---------------------------------------------------------------------------

  async program(restaurantId: string): Promise<ReferralProgramDTO | null> {
    const row = await this.prisma.referralProgram.findUnique({ where: { restaurantId } });
    return row ? this.toDto(row) : null;
  }

  /** Saves the programme and carries the friend terms onto every personal code, so customers see one offer. */
  async upsert(
    restaurantId: string,
    actorUserId: string,
    input: UpsertReferralProgramInput,
  ): Promise<ReferralProgramDTO> {
    const friend = friendCouponTerms(input);
    const data = {
      isActive: input.isActive,
      friendKind: friend.kind,
      friendPercentBps: friend.percentBps,
      friendMaxDiscountMinor: friend.maxDiscountMinor,
      friendAmountMinor: friend.amountMinor,
      friendMinBasketMinor: friend.minBasketMinor,
      rewardAmountMinor: input.rewardAmountMinor,
      rewardValidDays: input.rewardValidDays,
      monthlyCapPerReferrer: input.monthlyCapPerReferrer,
    };
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.referralProgram.upsert({
        where: { restaurantId },
        create: { restaurantId, ...data },
        update: data,
      });
      await tx.coupon.updateMany({ where: { restaurantId, source: 'REFERRAL' }, data: friend });
      await tx.auditLog.create({
        data: {
          actorUserId,
          restaurantId,
          action: 'referral_program.update',
          entity: 'ReferralProgram',
          entityId: saved.id,
          meta: { isActive: input.isActive },
        },
      });
      return saved;
    });
    return this.toDto(row);
  }

  // -- Customer ------------------------------------------------------------------------

  /** Every restaurant where this person is a customer and a programme is running. */
  async mine(userId: string): Promise<MyReferralDTO[]> {
    const customers = await this.prisma.restaurantCustomer.findMany({
      where: { userId, orderCount: { gt: 0 }, restaurant: { isActive: true, referralProgram: { isActive: true } } },
      orderBy: { lastOrderAt: 'desc' },
      take: 50,
      select: {
        id: true,
        restaurant: {
          select: { id: true, slug: true, name: true, currency: true, referralProgram: true },
        },
        referralCode: { select: { code: true } },
        rewardCoupons: {
          where: { source: 'REFERRAL_REWARD' },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { code: true, amountMinor: true, endsAt: true, redemptionCount: true },
        },
      },
    });
    const result: MyReferralDTO[] = [];
    for (const c of customers) {
      const program = c.restaurant.referralProgram;
      if (!program || !(await this.available(c.restaurant.id))) continue;
      result.push({
        restaurantId: c.restaurant.id,
        slug: c.restaurant.slug,
        name: c.restaurant.name,
        currency: c.restaurant.currency,
        code: c.referralCode?.code ?? null,
        friendKind: program.friendKind as CouponKind,
        friendPercentBps: program.friendPercentBps,
        friendMaxDiscountMinor: program.friendMaxDiscountMinor,
        friendAmountMinor: program.friendAmountMinor,
        friendMinBasketMinor: program.friendMinBasketMinor,
        rewardAmountMinor: program.rewardAmountMinor,
        rewardValidDays: program.rewardValidDays,
        rewards: c.rewardCoupons.map((r) => ({
          code: r.code,
          amountMinor: r.amountMinor ?? 0,
          endsAt: r.endsAt?.toISOString() ?? null,
          used: r.redemptionCount > 0,
        })),
      });
    }
    return result;
  }

  /** The customer's personal code, made on first ask; only someone who has ordered there can share one. */
  async codeFor(userId: string, restaurantId: string): Promise<MyReferralDTO> {
    const customer = await this.prisma.restaurantCustomer.findUnique({
      where: { restaurantId_userId: { restaurantId, userId } },
      select: { id: true, orderCount: true, referralCode: { select: { id: true } } },
    });
    const program = await this.prisma.referralProgram.findUnique({ where: { restaurantId } });
    if (!customer || customer.orderCount === 0 || !program?.isActive || !(await this.available(restaurantId))) {
      throw notFound('REFERRAL_NOT_AVAILABLE', 'No referral programme for this customer');
    }
    if (!customer.referralCode) {
      try {
        await this.prisma.coupon.create({
          data: {
            restaurantId,
            code: await this.freshCode(this.prisma, restaurantId, 'R'),
            ...friendCouponTerms(this.input(program)),
            firstOrderOnly: true,
            perCustomerLimit: 1,
            maxRedemptions: null,
            source: 'REFERRAL',
            referrerCustomerId: customer.id,
          },
        });
      } catch (err) {
        // Two tabs asking at once: the other one made the code, which is what this one returns.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
    }
    const mine = (await this.mine(userId)).find((m) => m.restaurantId === restaurantId);
    if (!mine) throw notFound('REFERRAL_NOT_AVAILABLE', 'No referral programme for this customer');
    return mine;
  }

  // -- Orders --------------------------------------------------------------------------

  /**
   * A completed order placed with a personal code rewards the referrer, once
   * per order, inside the completing transaction. Over the cap the friend
   * keeps the discount and the referrer gets nothing for this one.
   */
  async recordCompletion(tx: Prisma.TransactionClient, orderId: string, now: Date): Promise<void> {
    const redemption = await tx.couponRedemption.findUnique({
      where: { orderId },
      select: {
        restaurantId: true,
        customerId: true,
        currency: true,
        releasedAt: true,
        coupon: { select: { source: true, referrerCustomerId: true } },
      },
    });
    const referrerCustomerId = redemption?.coupon.referrerCustomerId;
    if (!redemption || redemption.releasedAt || redemption.coupon.source !== 'REFERRAL' || !referrerCustomerId) return;
    if (await tx.referralReward.findUnique({ where: { orderId }, select: { id: true } })) return;
    const program = await tx.referralProgram.findUnique({ where: { restaurantId: redemption.restaurantId } });
    if (!program) return;
    const recent = await tx.referralReward.count({
      where: {
        referrerCustomerId,
        status: 'GRANTED',
        createdAt: { gte: new Date(now.getTime() - REFERRAL_CAP_WINDOW_DAYS * DAY_MS) },
      },
    });
    const base = {
      restaurantId: redemption.restaurantId,
      referrerCustomerId,
      friendCustomerId: redemption.customerId,
      orderId,
      currency: redemption.currency,
      createdAt: now,
    };
    if (recent >= program.monthlyCapPerReferrer) {
      await tx.referralReward.create({ data: { ...base, status: 'SKIPPED_CAP' } });
      return;
    }
    const reward = await tx.coupon.create({
      data: {
        restaurantId: redemption.restaurantId,
        code: await this.freshCode(tx, redemption.restaurantId, 'W'),
        kind: 'AMOUNT',
        amountMinor: program.rewardAmountMinor,
        minBasketMinor: 0,
        firstOrderOnly: false,
        perCustomerLimit: 1,
        maxRedemptions: 1,
        startsAt: now,
        endsAt: new Date(now.getTime() + program.rewardValidDays * DAY_MS),
        source: 'REFERRAL_REWARD',
        ownerCustomerId: referrerCustomerId,
      },
      select: { id: true },
    });
    await tx.referralReward.create({
      data: { ...base, status: 'GRANTED', rewardCouponId: reward.id, valueMinor: program.rewardAmountMinor },
    });
  }

  // -- Helpers -------------------------------------------------------------------------

  /** The module is on and coupons can be used (module and plan). */
  private async available(restaurantId: string): Promise<boolean> {
    return (await this.features.isEnabled('referrals', restaurantId)) && (await this.coupons.accepts(restaurantId));
  }

  /**
   * A random code no coupon of the restaurant uses yet. Checked before the
   * insert rather than retried after it, because a failed insert would abort
   * the order's transaction; with 31^7 codes a clash is practically never.
   */
  private async freshCode(db: Prisma.TransactionClient | PrismaService, restaurantId: string, prefix: 'R' | 'W') {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = referralCodeFrom(randomBytes(7), prefix);
      const taken = await db.coupon.findUnique({
        where: { restaurantId_code: { restaurantId, code } },
        select: { id: true },
      });
      if (!taken) return code;
    }
    throw conflict('COUPON_CODE_TAKEN', 'No free code');
  }

  private input(row: ProgramRow): UpsertReferralProgramInput {
    const rules = {
      isActive: row.isActive,
      friendMinBasketMinor: row.friendMinBasketMinor,
      rewardAmountMinor: row.rewardAmountMinor,
      rewardValidDays: row.rewardValidDays,
      monthlyCapPerReferrer: row.monthlyCapPerReferrer,
    };
    return row.friendKind === 'PERCENT'
      ? {
          ...rules,
          friendKind: 'PERCENT',
          friendPercentBps: row.friendPercentBps ?? 0,
          friendMaxDiscountMinor: row.friendMaxDiscountMinor,
        }
      : { ...rules, friendKind: 'AMOUNT', friendAmountMinor: row.friendAmountMinor ?? 0 };
  }

  private async toDto(row: ProgramRow): Promise<ReferralProgramDTO> {
    const restaurantId = row.restaurantId;
    const [restaurant, codes, friendOrders, rewards, rewardsUsed] = await Promise.all([
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { currency: true } }),
      this.prisma.coupon.count({ where: { restaurantId, source: 'REFERRAL' } }),
      this.prisma.couponRedemption.aggregate({
        where: { restaurantId, releasedAt: null, coupon: { source: 'REFERRAL' } },
        _count: { _all: true },
        _sum: { discountMinor: true },
      }),
      this.prisma.referralReward.groupBy({
        by: ['status'],
        where: { restaurantId },
        _count: { _all: true },
        _sum: { valueMinor: true },
      }),
      this.prisma.coupon.count({ where: { restaurantId, source: 'REFERRAL_REWARD', redemptionCount: { gt: 0 } } }),
    ]);
    const granted = rewards.find((r) => r.status === 'GRANTED');
    return {
      isActive: row.isActive,
      friendKind: row.friendKind as CouponKind,
      friendPercentBps: row.friendPercentBps,
      friendMaxDiscountMinor: row.friendMaxDiscountMinor,
      friendAmountMinor: row.friendAmountMinor,
      friendMinBasketMinor: row.friendMinBasketMinor,
      rewardAmountMinor: row.rewardAmountMinor,
      rewardValidDays: row.rewardValidDays,
      monthlyCapPerReferrer: row.monthlyCapPerReferrer,
      currency: restaurant.currency,
      stats: {
        codes,
        friendOrders: friendOrders._count._all,
        friendDiscountMinor: friendOrders._sum.discountMinor ?? 0,
        rewardsGranted: granted?._count._all ?? 0,
        rewardsSkipped: rewards.find((r) => r.status === 'SKIPPED_CAP')?._count._all ?? 0,
        rewardValueMinor: granted?._sum.valueMinor ?? 0,
        rewardsUsed,
      },
    };
  }
}
