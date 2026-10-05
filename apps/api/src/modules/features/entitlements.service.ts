import { Injectable } from '@nestjs/common';
import { FALLBACK_PLAN_CODE, effectivePlan, graceUntil, planFeaturesFrom, resolveEntitlements } from '@resget/shared';
import type { EntitlementKey, PlanCode, SubscriptionLike } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';

/** How long a process trusts its copy of the plan rows; writes in this process refresh it at once. */
const CACHE_TTL_MS = 15_000;

interface PlanRow {
  id: string;
  code: string;
  name: string;
  features: EntitlementKey[];
}

interface PlanSnapshot {
  byCode: Map<string, PlanRow>;
  loadedAt: number;
}

/** What applies to one restaurant right now. */
export interface ResolvedEntitlements {
  planCode: PlanCode;
  planName: string;
  planFeatures: EntitlementKey[];
  entitlements: Set<EntitlementKey>;
}

/** The subscription columns the resolution needs, as a Prisma select. */
export const subscriptionForPlanSelect = {
  status: true,
  trialEndsAt: true,
  currentPeriodEnd: true,
  plan: { select: { code: true } },
} as const;

export interface SubscriptionRow {
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  plan: { code: string };
}

export function subscriptionLike(row: SubscriptionRow | null | undefined): SubscriptionLike | null {
  return row
    ? {
        planCode: row.plan.code,
        status: row.status as SubscriptionLike['status'],
        trialEndsAt: row.trialEndsAt,
        currentPeriodEnd: row.currentPeriodEnd,
      }
    : null;
}

/**
 * Plan entitlements (docs/PLAN_MATRISI.md): the effective plan's feature
 * list plus the restaurant's running grants. Plan rows are few and change
 * rarely, so every process keeps them and reloads every few seconds; the
 * subscription and the grants are read per call, so an upgrade or a new
 * exception applies at once.
 */
@Injectable()
export class EntitlementsService {
  private snapshot: PlanSnapshot | null = null;
  private loading: Promise<PlanSnapshot> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async forRestaurant(restaurantId: string, now: Date = new Date()): Promise<ResolvedEntitlements> {
    const [row, grants] = await Promise.all([
      this.prisma.restaurantSubscription.findUnique({ where: { restaurantId }, select: subscriptionForPlanSelect }),
      this.grantsOf(restaurantId, now),
    ]);
    return this.resolve(subscriptionLike(row), grants, now);
  }

  /** The same resolution from a subscription the caller already loaded (the tenant guard). */
  async resolveFor(
    restaurantId: string,
    subscription: SubscriptionLike | null,
    now: Date = new Date(),
  ): Promise<ResolvedEntitlements> {
    return this.resolve(subscription, await this.grantsOf(restaurantId, now), now);
  }

  async has(restaurantId: string, key: EntitlementKey): Promise<boolean> {
    return (await this.forRestaurant(restaurantId)).entitlements.has(key);
  }

  /** The current plan rows by code, features as the positive list. */
  async plans(): Promise<Map<string, PlanRow>> {
    return (await this.current()).byCode;
  }

  /** Reloads the plan rows; called after the console changes a plan. */
  async refresh(): Promise<void> {
    await this.fresh();
  }

  /** How long a restaurant keeps a key that leaves the plan it is on. */
  graceUntil(subscription: SubscriptionLike | null, now: Date = new Date()): Date {
    return graceUntil(subscription, effectivePlan(subscription, now), now);
  }

  private async resolve(
    subscription: SubscriptionLike | null,
    grants: { key: string; until: Date | null }[],
    now: Date,
  ): Promise<ResolvedEntitlements> {
    const plans = await this.plans();
    const code = effectivePlan(subscription, now);
    // A plan row that went missing behaves as the fallback; a missing fallback as the core alone.
    const plan = plans.get(code) ?? plans.get(FALLBACK_PLAN_CODE);
    const planFeatures = plan ? plan.features : resolveEntitlements([], []);
    return {
      planCode: plan?.code ?? FALLBACK_PLAN_CODE,
      planName: plan?.name ?? FALLBACK_PLAN_CODE,
      planFeatures,
      entitlements: new Set(resolveEntitlements(planFeatures, grants, now)),
    };
  }

  private grantsOf(restaurantId: string, now: Date): Promise<{ key: string; until: Date | null }[]> {
    return this.prisma.restaurantEntitlement.findMany({
      where: { restaurantId, OR: [{ until: null }, { until: { gt: now } }] },
      select: { key: true, until: true },
    });
  }

  private async current(): Promise<PlanSnapshot> {
    if (this.snapshot && Date.now() - this.snapshot.loadedAt < CACHE_TTL_MS) return this.snapshot;
    return this.fresh();
  }

  private fresh(): Promise<PlanSnapshot> {
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(): Promise<PlanSnapshot> {
    const rows = await this.prisma.plan.findMany({
      select: { id: true, code: true, name: true, excludedFeatures: true },
    });
    const snapshot: PlanSnapshot = {
      byCode: new Map(
        rows.map((r) => [
          r.code,
          { id: r.id, code: r.code, name: r.name, features: planFeaturesFrom(r.excludedFeatures) },
        ]),
      ),
      loadedAt: Date.now(),
    };
    this.snapshot = snapshot;
    return snapshot;
  }
}
