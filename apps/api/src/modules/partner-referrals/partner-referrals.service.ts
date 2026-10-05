import { randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { PARTNER_REFERRAL_CAP_WINDOW_DAYS, PartnerCodeSchema, proExtension, referralCodeFrom } from '@resget/shared';
import type {
  AdminPartnerReferralDTO,
  MyPartnerReferralsDTO,
  PartnerInviteDTO,
  PartnerReferralConfigDTO,
  PartnerReferralStatus,
  SubscriptionState,
  UpdatePartnerReferralConfigInput,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { conflict, notFound } from '../../common/api-error';

type Db = Prisma.TransactionClient | PrismaService;
const DAY_MS = 24 * 60 * 60 * 1000;
const COMPLETED = ['DELIVERED', 'PICKED_UP'] as const;
const DEFAULTS: UpdatePartnerReferralConfigInput = {
  isActive: false,
  referrerRewardDays: 30,
  refereeBonusDays: 30,
  qualifyingOrders: 10,
  yearlyCapPerReferrer: 12,
};

/**
 * Restaurant-to-restaurant referrals (docs/RESTORAN_TAVSIYE.md). Every
 * reward is PRO time added to a subscription (proExtension in shared);
 * commission, invoices and settlement are never touched. The new
 * restaurant's bonus lands at sign-up, the referrer's when the new
 * restaurant completes its qualifying order, in that order's transaction.
 */
@Injectable()
export class PartnerReferralsService {
  private readonly logger = new Logger(PartnerReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
  ) {}

  // -- Console -------------------------------------------------------------------------

  async config(db: Db = this.prisma): Promise<PartnerReferralConfigDTO> {
    const row = await db.partnerReferralConfig.findUnique({ where: { id: 'default' } });
    return row
      ? {
          isActive: row.isActive,
          referrerRewardDays: row.referrerRewardDays,
          refereeBonusDays: row.refereeBonusDays,
          qualifyingOrders: row.qualifyingOrders,
          yearlyCapPerReferrer: row.yearlyCapPerReferrer,
          updatedAt: row.updatedAt.toISOString(),
        }
      : { ...DEFAULTS, updatedAt: null };
  }

  async updateConfig(actorUserId: string, input: UpdatePartnerReferralConfigInput): Promise<PartnerReferralConfigDTO> {
    await this.prisma.partnerReferralConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...input, updatedByUserId: actorUserId },
      update: { ...input, updatedByUserId: actorUserId },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'partner_referral.config',
        entity: 'PartnerReferralConfig',
        entityId: 'default',
        meta: { ...input },
      },
    });
    return this.config();
  }

  async adminList(): Promise<AdminPartnerReferralDTO[]> {
    const rows = await this.prisma.partnerReferral.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        referrer: { select: { id: true, name: true, slug: true } },
        referee: { select: { id: true, name: true, slug: true } },
      },
    });
    const counts = await this.completedCounts(rows.map((r) => r.refereeRestaurantId));
    return rows.map((r) => ({
      referrer: r.referrer,
      referee: r.referee,
      status: r.status as PartnerReferralStatus,
      refereeBonusDays: r.refereeBonusDays,
      rewardDays: r.rewardDays,
      completedOrders: counts.get(r.refereeRestaurantId) ?? 0,
      createdAt: r.createdAt.toISOString(),
      rewardedAt: r.rewardedAt?.toISOString() ?? null,
    }));
  }

  // -- Referrer ------------------------------------------------------------------------

  async mine(restaurantId: string): Promise<MyPartnerReferralsDTO> {
    const [config, restaurant, rows] = await Promise.all([
      this.config(),
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { partnerCode: true } }),
      this.prisma.partnerReferral.findMany({
        where: { referrerRestaurantId: restaurantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { referee: { select: { name: true } } },
      }),
    ]);
    const counts = await this.completedCounts(rows.map((r) => r.refereeRestaurantId));
    return {
      isActive: config.isActive,
      code: restaurant.partnerCode,
      referrerRewardDays: config.referrerRewardDays,
      refereeBonusDays: config.refereeBonusDays,
      qualifyingOrders: config.qualifyingOrders,
      rewardDaysEarned: rows.reduce((sum, r) => sum + (r.status === 'REWARDED' ? (r.rewardDays ?? 0) : 0), 0),
      referrals: rows.map((r) => ({
        restaurantName: r.referee.name,
        createdAt: r.createdAt.toISOString(),
        status: r.status as PartnerReferralStatus,
        completedOrders: counts.get(r.refereeRestaurantId) ?? 0,
        rewardedAt: r.rewardedAt?.toISOString() ?? null,
        rewardDays: r.rewardDays,
      })),
    };
  }

  /** The restaurant's partner code, made on first ask; only while the programme runs. */
  async codeFor(restaurantId: string): Promise<MyPartnerReferralsDTO> {
    if (!(await this.config()).isActive) throw notFound('REFERRAL_NOT_AVAILABLE', 'The programme is not running');
    const current = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { partnerCode: true },
    });
    if (!current.partnerCode) {
      for (let attempt = 0; ; attempt++) {
        try {
          // Only set while still empty, so two tabs end up with the same code.
          await this.prisma.restaurant.updateMany({
            where: { id: restaurantId, partnerCode: null },
            data: { partnerCode: referralCodeFrom((max) => randomInt(max), 'P') },
          });
          break;
        } catch (err) {
          const taken = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
          if (!taken || attempt >= 4) throw taken ? conflict('COUPON_CODE_TAKEN', 'No free code') : err;
        }
      }
    }
    return this.mine(restaurantId);
  }

  // -- Sign-up -------------------------------------------------------------------------

  /** What an invite link shows on the sign-up page; not found when it cannot be used. */
  async invite(code: string): Promise<PartnerInviteDTO> {
    const referrer = await this.usableReferrer(code);
    if (!referrer) throw notFound('REFERRAL_NOT_AVAILABLE', 'Invite not usable');
    return { restaurantName: referrer.name, refereeBonusDays: (await this.config()).refereeBonusDays };
  }

  /**
   * Links a new restaurant to its referrer and gives it the bonus days. A
   * code that cannot be used (unknown, programme off, referrer switched off,
   * or the new owner already works at the referrer) is ignored: sign-up
   * never fails because of it.
   */
  async onSignupSafely(refereeRestaurantId: string, ownerUserId: string, rawCode: string | undefined): Promise<void> {
    if (!rawCode) return;
    try {
      const parsed = PartnerCodeSchema.safeParse(rawCode);
      if (!parsed.success) return;
      const referrer = await this.usableReferrer(parsed.data);
      if (!referrer || referrer.id === refereeRestaurantId) return;
      const ownSide = await this.prisma.membership.findFirst({
        where: { restaurantId: referrer.id, userId: ownerUserId },
        select: { id: true },
      });
      if (ownSide) return;
      const config = await this.config();
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.partnerReferral.create({
          data: {
            referrerRestaurantId: referrer.id,
            refereeRestaurantId,
            code: parsed.data,
            refereeBonusDays: config.refereeBonusDays,
          },
        });
        if (config.refereeBonusDays > 0) await this.addProDays(tx, refereeRestaurantId, config.refereeBonusDays, now);
        await tx.auditLog.create({
          data: {
            restaurantId: refereeRestaurantId,
            action: 'partner_referral.joined',
            entity: 'PartnerReferral',
            entityId: referrer.id,
            meta: { bonusDays: config.refereeBonusDays },
          },
        });
      });
    } catch (err) {
      this.logger.warn(`Partner referral not recorded: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  // -- Orders --------------------------------------------------------------------------

  /** The referred restaurant's qualifying completed order rewards the referrer, once. */
  async recordCompletion(tx: Prisma.TransactionClient, orderId: string, now: Date): Promise<void> {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { restaurantId: true } });
    if (!order) return;
    const referral = await tx.partnerReferral.findUnique({ where: { refereeRestaurantId: order.restaurantId } });
    if (!referral || referral.status !== 'PENDING') return;
    const config = await this.config(tx);
    const completed = await tx.order.count({
      where: { restaurantId: order.restaurantId, status: { in: [...COMPLETED] } },
    });
    if (completed < config.qualifyingOrders) return;
    const recent = await tx.partnerReferral.count({
      where: {
        referrerRestaurantId: referral.referrerRestaurantId,
        status: 'REWARDED',
        rewardedAt: { gte: new Date(now.getTime() - PARTNER_REFERRAL_CAP_WINDOW_DAYS * DAY_MS) },
      },
    });
    if (recent >= config.yearlyCapPerReferrer) {
      await tx.partnerReferral.update({ where: { id: referral.id }, data: { status: 'CAPPED', rewardedAt: now } });
      return;
    }
    if (config.referrerRewardDays > 0) {
      await this.addProDays(tx, referral.referrerRestaurantId, config.referrerRewardDays, now);
    }
    await tx.partnerReferral.update({
      where: { id: referral.id },
      data: { status: 'REWARDED', rewardDays: config.referrerRewardDays, rewardedAt: now },
    });
    await tx.auditLog.create({
      data: {
        restaurantId: referral.referrerRestaurantId,
        action: 'partner_referral.rewarded',
        entity: 'PartnerReferral',
        entityId: referral.id,
        meta: { days: config.referrerRewardDays },
      },
    });
  }

  // -- Helpers -------------------------------------------------------------------------

  /** The restaurant behind a code while the programme runs and the module is on for it. */
  private async usableReferrer(code: string): Promise<{ id: string; name: string } | null> {
    const parsed = PartnerCodeSchema.safeParse(code);
    if (!parsed.success || !(await this.config()).isActive) return null;
    const referrer = await this.prisma.restaurant.findUnique({
      where: { partnerCode: parsed.data },
      select: { id: true, name: true, isActive: true, isPlatform: true },
    });
    if (!referrer || !referrer.isActive || referrer.isPlatform) return null;
    if (!(await this.features.isEnabled('partner_referrals', referrer.id))) return null;
    return { id: referrer.id, name: referrer.name };
  }

  /** Adds PRO days to a restaurant's subscription (proExtension decides how). */
  private async addProDays(tx: Prisma.TransactionClient, restaurantId: string, days: number, now: Date): Promise<void> {
    const sub = await tx.restaurantSubscription.findUnique({
      where: { restaurantId },
      select: { id: true, status: true, trialEndsAt: true, currentPeriodEnd: true, plan: { select: { code: true } } },
    });
    const state: SubscriptionState | null = sub
      ? {
          planCode: sub.plan.code,
          status: sub.status as SubscriptionState['status'],
          trialEndsAt: sub.trialEndsAt,
          currentPeriodEnd: sub.currentPeriodEnd,
        }
      : null;
    const change = proExtension(state, days, now);
    if (change.kind === 'UNCHANGED') return;
    if (change.kind === 'TRIAL') {
      await tx.restaurantSubscription.update({ where: { restaurantId }, data: { trialEndsAt: change.trialEndsAt } });
      return;
    }
    if (change.kind === 'PERIOD') {
      await tx.restaurantSubscription.update({
        where: { restaurantId },
        data: { currentPeriodEnd: change.currentPeriodEnd },
      });
      return;
    }
    const pro = await tx.plan.findFirst({ where: { code: 'PRO' }, select: { id: true } });
    if (!pro) return;
    await tx.restaurantSubscription.upsert({
      where: { restaurantId },
      create: { restaurantId, planId: pro.id, status: 'TRIALING', trialEndsAt: change.trialEndsAt },
      update: { planId: pro.id, status: 'TRIALING', trialEndsAt: change.trialEndsAt, cancelledAt: null },
    });
  }

  private async completedCounts(restaurantIds: string[]): Promise<Map<string, number>> {
    if (restaurantIds.length === 0) return new Map();
    const groups = await this.prisma.order.groupBy({
      by: ['restaurantId'],
      where: { restaurantId: { in: restaurantIds }, status: { in: [...COMPLETED] } },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.restaurantId, g._count._all]));
  }
}
