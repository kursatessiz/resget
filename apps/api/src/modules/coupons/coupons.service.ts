import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { couponDiscountMinor, couponRefusal, hasFeature } from '@resget/shared';
import type {
  CouponDTO,
  CouponKind,
  CouponTerms,
  CreateCouponInput,
  PlanCode,
  PublicCouponDTO,
  SubscriptionStatus as SharedSubscriptionStatus,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { conflict, notFound } from '../../common/api-error';
import type { ApiErrorCode } from '../../common/api-error';

type Db = Prisma.TransactionClient | PrismaService;
type CouponRow = Prisma.CouponGetPayload<object>;

/** Statuses after which an order's coupon use is given back. */
export const COUPON_RELEASE_STATUSES = [
  'REJECTED',
  'CANCELLED_BY_RESTAURANT',
  'CANCELLED_BY_CUSTOMER',
  'REFUNDED',
] as const;

/** A coupon checked against an order before the order exists; applied inside the order's transaction. */
export interface PreparedCoupon {
  couponId: string;
  code: string;
  discountMinor: number;
  perCustomerLimit: number;
}

/**
 * Coupons and promo codes (docs/KUPONLAR.md): a restaurant-funded discount.
 * The total limit is a counter raised atomically with the order and lowered
 * when the order is cancelled, so a limited coupon never oversells; every
 * use is a redemption row tied to its order.
 */
@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
  ) {}

  // -- Panel ---------------------------------------------------------------------------

  async list(restaurantId: string): Promise<CouponDTO[]> {
    const [rows, restaurant, given] = await Promise.all([
      // Personal referral codes and reward coupons live with the referral programme (docs/TAVSIYE.md).
      this.prisma.coupon.findMany({ where: { restaurantId, source: 'MANUAL' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { currency: true } }),
      this.prisma.couponRedemption.groupBy({
        by: ['couponId'],
        where: { restaurantId, releasedAt: null },
        _sum: { discountMinor: true },
      }),
    ]);
    const totals = new Map(given.map((g) => [g.couponId, g._sum.discountMinor ?? 0]));
    return rows.map((row) => this.toDto(row, restaurant.currency, totals.get(row.id) ?? 0));
  }

  async create(restaurantId: string, actorUserId: string, input: CreateCouponInput): Promise<CouponDTO> {
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { currency: true },
    });
    try {
      const row = await this.prisma.coupon.create({
        data: {
          restaurantId,
          code: input.code,
          kind: input.kind,
          percentBps: input.kind === 'PERCENT' ? input.percentBps : null,
          maxDiscountMinor: input.kind === 'PERCENT' ? input.maxDiscountMinor : null,
          amountMinor: input.kind === 'AMOUNT' ? input.amountMinor : null,
          minBasketMinor: input.minBasketMinor,
          firstOrderOnly: input.firstOrderOnly,
          perCustomerLimit: input.perCustomerLimit,
          maxRedemptions: input.maxRedemptions,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          createdByUserId: actorUserId,
        },
      });
      await this.audit(restaurantId, actorUserId, 'coupon.create', row.id, { code: row.code });
      return this.toDto(row, restaurant.currency, 0);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('COUPON_CODE_TAKEN', 'Code already used by another coupon');
      }
      throw err;
    }
  }

  async setActive(restaurantId: string, actorUserId: string, couponId: string, isActive: boolean): Promise<CouponDTO> {
    const updated = await this.prisma.coupon.updateMany({
      where: { id: couponId, restaurantId, source: 'MANUAL' },
      data: { isActive },
    });
    if (updated.count === 0) throw notFound('COUPON_NOT_FOUND', 'Coupon not found');
    await this.audit(restaurantId, actorUserId, isActive ? 'coupon.resume' : 'coupon.pause', couponId, {});
    const coupon = (await this.list(restaurantId)).find((c) => c.id === couponId);
    if (!coupon) throw notFound('COUPON_NOT_FOUND', 'Coupon not found');
    return coupon;
  }

  /** Only a coupon nobody used goes away; a used one stays for the books and is paused instead. */
  async remove(restaurantId: string, actorUserId: string, couponId: string): Promise<void> {
    const coupon = await this.prisma.coupon.findFirst({
      where: { id: couponId, restaurantId, source: 'MANUAL' },
      select: { id: true, code: true, _count: { select: { redemptions: true } } },
    });
    if (!coupon) throw notFound('COUPON_NOT_FOUND', 'Coupon not found');
    if (coupon._count.redemptions > 0) throw conflict('COUPON_IN_USE', 'A used coupon cannot be deleted');
    await this.prisma.coupon.delete({ where: { id: coupon.id } });
    await this.audit(restaurantId, actorUserId, 'coupon.delete', coupon.id, { code: coupon.code });
  }

  // -- Checkout ------------------------------------------------------------------------

  /**
   * What the menu page shows for a typed code. Unknown, paused, not yet
   * started, switched off or a BASIC restaurant all read as not found: the
   * customer learns nothing about codes that do not apply.
   */
  async publicLookup(slug: string, code: string): Promise<PublicCouponDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true, isActive: true },
    });
    if (!restaurant || !restaurant.isActive) throw notFound('COUPON_NOT_FOUND', 'Coupon not found');
    const { coupon, currency } = await this.usable(this.prisma, restaurant.id, code);
    const refusal = couponRefusal(this.terms(coupon), {
      now: new Date(),
      itemsGrossMinor: Number.MAX_SAFE_INTEGER,
      customerOrderCount: 0,
      customerRedemptions: 0,
      totalRedemptions: coupon.redemptionCount,
    });
    if (refusal) this.refuse(refusal);
    return {
      code: coupon.code,
      kind: coupon.kind as CouponKind,
      percentBps: coupon.percentBps,
      maxDiscountMinor: coupon.maxDiscountMinor,
      amountMinor: coupon.amountMinor,
      minBasketMinor: coupon.minBasketMinor,
      firstOrderOnly: coupon.firstOrderOnly,
      currency,
    };
  }

  /** Checks a code for an order about to be created by this phone; the discount goes into the settlement. */
  async prepare(restaurantId: string, code: string, phone: string, itemsGrossMinor: number): Promise<PreparedCoupon> {
    const { coupon } = await this.usable(this.prisma, restaurantId, code);
    const customer = await this.prisma.restaurantCustomer.findFirst({
      where: { restaurantId, user: { phone } },
      select: { id: true, orderCount: true },
    });
    const customerRedemptions = customer
      ? await this.prisma.couponRedemption.count({
          where: { couponId: coupon.id, customerId: customer.id, releasedAt: null },
        })
      : 0;
    // A reward coupon is its owner's alone; to anyone else it does not exist (docs/TAVSIYE.md).
    if (coupon.ownerCustomerId && coupon.ownerCustomerId !== customer?.id) this.refuse('COUPON_NOT_FOUND');
    if (coupon.referrerCustomerId && coupon.referrerCustomerId === customer?.id) this.refuse('COUPON_OWN_REFERRAL');
    const refusal = couponRefusal(this.terms(coupon), {
      now: new Date(),
      itemsGrossMinor,
      customerOrderCount: customer?.orderCount ?? 0,
      customerRedemptions,
      totalRedemptions: coupon.redemptionCount,
    });
    if (refusal) this.refuse(refusal);
    return {
      couponId: coupon.id,
      code: coupon.code,
      discountMinor: couponDiscountMinor(this.terms(coupon), itemsGrossMinor),
      perCustomerLimit: coupon.perCustomerLimit,
    };
  }

  /**
   * Takes one use for an order that was just created, in the order's
   * transaction: the counter only moves while it is under the limit, and the
   * customer's own uses are counted again so two tabs cannot both pass.
   */
  async apply(
    tx: Prisma.TransactionClient,
    restaurantId: string,
    prepared: PreparedCoupon,
    orderId: string,
    customerId: string,
    discountMinor: number,
    currency: string,
  ): Promise<void> {
    const taken = await tx.$executeRaw`
      UPDATE "coupons" SET "redemptionCount" = "redemptionCount" + 1, "updatedAt" = NOW()
      WHERE "id" = ${prepared.couponId} AND "isActive" = true
        AND ("maxRedemptions" IS NULL OR "redemptionCount" < "maxRedemptions")`;
    if (taken !== 1) this.refuse('COUPON_LIMIT_REACHED');
    const mine = await tx.couponRedemption.count({
      where: { couponId: prepared.couponId, customerId, releasedAt: null },
    });
    if (mine >= prepared.perCustomerLimit) this.refuse('COUPON_ALREADY_USED');
    await tx.couponRedemption.create({
      data: { restaurantId, couponId: prepared.couponId, orderId, customerId, discountMinor, currency },
    });
  }

  /** A cancelled, rejected or refunded order gives its use back, once. */
  async release(tx: Prisma.TransactionClient, orderId: string, now: Date = new Date()): Promise<void> {
    const released = await tx.couponRedemption.updateMany({
      where: { orderId, releasedAt: null },
      data: { releasedAt: now },
    });
    if (released.count === 0) return;
    const redemption = await tx.couponRedemption.findUniqueOrThrow({ where: { orderId }, select: { couponId: true } });
    await tx.coupon.updateMany({
      where: { id: redemption.couponId, redemptionCount: { gt: 0 } },
      data: { redemptionCount: { decrement: 1 } },
    });
  }

  /** Whether the menu page offers a coupon field: the module is on and the plan includes coupons. */
  async accepts(restaurantId: string): Promise<boolean> {
    if (!(await this.features.isEnabled('coupons', restaurantId))) return false;
    return hasFeature(await this.subscriptionOf(this.prisma, restaurantId), 'coupons');
  }

  // -- Helpers -------------------------------------------------------------------------

  private async subscriptionOf(db: Db, restaurantId: string) {
    const row = await db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: {
        subscription: {
          select: { plan: { select: { code: true } }, status: true, trialEndsAt: true, currentPeriodEnd: true },
        },
      },
    });
    return row.subscription
      ? {
          planCode: (row.subscription.plan.code === 'PRO' ? 'PRO' : 'BASIC') as PlanCode,
          status: row.subscription.status as unknown as SharedSubscriptionStatus,
          trialEndsAt: row.subscription.trialEndsAt,
          currentPeriodEnd: row.subscription.currentPeriodEnd,
        }
      : null;
  }

  /** The coupon when the module is on, the plan includes coupons and the code exists; not found otherwise. */
  private async usable(db: Db, restaurantId: string, code: string): Promise<{ coupon: CouponRow; currency: string }> {
    if (!(await this.features.isEnabled('coupons', restaurantId))) this.refuse('COUPON_NOT_FOUND');
    if (!hasFeature(await this.subscriptionOf(db, restaurantId), 'coupons')) this.refuse('COUPON_NOT_FOUND');
    const restaurant = await db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { currency: true },
    });
    const coupon = await db.coupon.findUnique({ where: { restaurantId_code: { restaurantId, code } } });
    if (!coupon) this.refuse('COUPON_NOT_FOUND');
    // A personal code works only while the referral module and the programme are on; rewards already given stay usable.
    if (coupon.source === 'REFERRAL') {
      const program = await db.referralProgram.findUnique({ where: { restaurantId }, select: { isActive: true } });
      if (!program?.isActive || !(await this.features.isEnabled('referrals', restaurantId))) {
        this.refuse('COUPON_NOT_FOUND');
      }
    }
    return { coupon, currency: restaurant.currency };
  }

  private terms(row: CouponRow): CouponTerms {
    return {
      kind: row.kind as CouponKind,
      percentBps: row.percentBps,
      maxDiscountMinor: row.maxDiscountMinor,
      amountMinor: row.amountMinor,
      minBasketMinor: row.minBasketMinor,
      firstOrderOnly: row.firstOrderOnly,
      perCustomerLimit: row.perCustomerLimit,
      maxRedemptions: row.maxRedemptions,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      isActive: row.isActive,
    };
  }

  private refuse(code: ApiErrorCode): never {
    if (code === 'COUPON_NOT_FOUND') throw notFound(code, 'Coupon not found');
    throw conflict(code, `Coupon refused: ${code}`);
  }

  private toDto(row: CouponRow, currency: string, discountTotalMinor: number): CouponDTO {
    return {
      id: row.id,
      code: row.code,
      kind: row.kind as CouponKind,
      percentBps: row.percentBps,
      maxDiscountMinor: row.maxDiscountMinor,
      amountMinor: row.amountMinor,
      minBasketMinor: row.minBasketMinor,
      firstOrderOnly: row.firstOrderOnly,
      perCustomerLimit: row.perCustomerLimit,
      maxRedemptions: row.maxRedemptions,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      isActive: row.isActive,
      redemptionCount: row.redemptionCount,
      discountTotalMinor,
      currency,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async audit(
    restaurantId: string,
    actorUserId: string,
    action: string,
    entityId: string,
    meta: Record<string, string>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: { actorUserId, restaurantId, action, entity: 'Coupon', entityId, meta },
    });
  }
}
