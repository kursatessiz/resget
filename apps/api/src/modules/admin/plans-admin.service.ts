import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { CORE_ENTITLEMENTS, FALLBACK_PLAN_CODE, effectivePlan, exclusionsFrom, planFeaturesFrom } from '@resget/shared';
import type {
  AssignPlanInput,
  CreateEntitlementExceptionInput,
  CreatePlanInput,
  EntitlementKey,
  EntitlementSource,
  PlanDTO,
  PlanFeaturesChangeDTO,
  RestaurantEntitlementDTO,
  RestaurantEntitlementsDTO,
  UpdatePlanInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService, subscriptionForPlanSelect, subscriptionLike } from '../features/entitlements.service';
import { badRequest, conflict, notFound } from '../../common/api-error';

/**
 * The console's plan matrix (docs/PLAN_MATRISI.md): plans as data, the keys
 * each one carries, grace when a key leaves a plan, and per-restaurant
 * exceptions. Every change is audited.
 */
@Injectable()
export class PlansAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: EntitlementsService,
  ) {}

  async list(): Promise<PlanDTO[]> {
    const rows = await this.prisma.plan.findMany({
      orderBy: [{ monthlyPriceMinor: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { subscriptions: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      monthlyPriceMinor: p.monthlyPriceMinor,
      currency: p.currency,
      isFree: p.isFree,
      trialDays: p.trialDays,
      isActive: p.isActive,
      subscriptions: p._count.subscriptions,
      features: planFeaturesFrom(p.excludedFeatures),
      isFallback: p.code === FALLBACK_PLAN_CODE,
    }));
  }

  async create(actorUserId: string, input: CreatePlanInput): Promise<PlanDTO> {
    const taken = await this.prisma.plan.findUnique({ where: { code: input.code }, select: { id: true } });
    if (taken) throw conflict('PLAN_CODE_TAKEN', 'A plan with this code exists');
    const { features, ...rest } = input;
    const row = await this.prisma.plan.create({
      data: { ...rest, isFree: rest.monthlyPriceMinor === 0, excludedFeatures: exclusionsFrom(features) },
      select: { id: true },
    });
    await this.audit(actorUserId, null, 'plan.created', 'plan', row.id, { ...rest, features });
    await this.plans.refresh();
    return (await this.list()).find((p) => p.id === row.id)!;
  }

  async update(actorUserId: string, id: string, input: UpdatePlanInput): Promise<PlanDTO> {
    const plan = await this.prisma.plan.findUnique({ where: { id }, select: { id: true, code: true } });
    if (!plan) throw notFound('PLAN_NOT_FOUND', 'Plan not found');
    // Every restaurant falls back to the free plan, so it can neither stop being sold nor start costing money.
    if (plan.code === FALLBACK_PLAN_CODE && (input.isActive === false || (input.monthlyPriceMinor ?? 0) > 0)) {
      throw conflict('PLAN_FALLBACK_LOCKED', 'The fallback plan stays free and active');
    }
    await this.prisma.$transaction([
      this.prisma.plan.update({ where: { id }, data: input }),
      this.audit(actorUserId, null, 'plan.updated', 'plan', id, input as Prisma.InputJsonObject),
    ]);
    await this.plans.refresh();
    return (await this.list()).find((p) => p.id === id)!;
  }

  /**
   * Sets the keys a plan carries. A key taken out stays with every restaurant
   * on the plan until the end of its period, as a GRACE grant; a longer grace
   * the restaurant already holds is kept.
   */
  async setFeatures(
    actorUserId: string,
    id: string,
    features: readonly EntitlementKey[],
    now: Date = new Date(),
  ): Promise<PlanFeaturesChangeDTO> {
    const plan = await this.prisma.plan.findUnique({ where: { id }, select: { code: true, excludedFeatures: true } });
    if (!plan) throw notFound('PLAN_NOT_FOUND', 'Plan not found');
    const before = planFeaturesFrom(plan.excludedFeatures);
    const after = planFeaturesFrom(exclusionsFrom(features));
    const added = after.filter((key) => !before.includes(key));
    const removed = before.filter((key) => !after.includes(key) && !CORE_ENTITLEMENTS.includes(key));

    const graces = removed.length > 0 ? await this.graceFor(plan.code, removed, now) : [];
    await this.prisma.$transaction([
      this.prisma.plan.update({ where: { id }, data: { excludedFeatures: exclusionsFrom(after) } }),
      ...graces.map((g) =>
        this.prisma.restaurantEntitlement.upsert({
          where: { restaurantId_key_source: { restaurantId: g.restaurantId, key: g.key, source: 'GRACE' } },
          create: {
            restaurantId: g.restaurantId,
            key: g.key,
            source: 'GRACE',
            until: g.until,
            createdByUserId: actorUserId,
          },
          update: { until: g.until, createdByUserId: actorUserId },
        }),
      ),
      this.audit(actorUserId, null, 'plan.features_updated', 'plan', id, {
        added,
        removed,
        graceGranted: graces.length,
      }),
    ]);
    await this.plans.refresh();
    return { added, removed, graceGranted: graces.length };
  }

  // -- Per restaurant ------------------------------------------------------------

  async restaurantEntitlements(restaurantId: string): Promise<RestaurantEntitlementsDTO> {
    const exists = await this.prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } });
    if (!exists) throw notFound('NOT_FOUND', 'Restaurant not found');
    const now = new Date();
    const [resolved, grants] = await Promise.all([
      this.plans.forRestaurant(restaurantId, now),
      this.prisma.restaurantEntitlement.findMany({
        where: { restaurantId, OR: [{ until: null }, { until: { gt: now } }] },
        orderBy: [{ source: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    return {
      planCode: resolved.planCode,
      planName: resolved.planName,
      planFeatures: resolved.planFeatures,
      entitlements: [...resolved.entitlements],
      grants: grants.map((g) => this.toGrant(g)),
    };
  }

  /** Puts the restaurant on a plan now (docs/PLAN_MATRISI.md); a period end in the past is refused. */
  async assignPlan(
    actorUserId: string,
    restaurantId: string,
    input: AssignPlanInput,
  ): Promise<RestaurantEntitlementsDTO> {
    const [restaurant, plan] = await Promise.all([
      this.prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } }),
      this.prisma.plan.findUnique({ where: { id: input.planId }, select: { id: true, code: true } }),
    ]);
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    if (!plan) throw notFound('PLAN_NOT_FOUND', 'Plan not found');
    const currentPeriodEnd = input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null;
    if (currentPeriodEnd && currentPeriodEnd.getTime() <= Date.now())
      throw badRequest('VALIDATION', 'The period must end in the future');
    const data = { planId: plan.id, status: 'ACTIVE' as const, trialEndsAt: null, currentPeriodEnd, cancelledAt: null };
    await this.prisma.$transaction([
      this.prisma.restaurantSubscription.upsert({
        where: { restaurantId },
        create: { restaurantId, ...data },
        update: data,
      }),
      this.audit(actorUserId, restaurantId, 'subscription.assigned', 'restaurant', restaurantId, {
        plan: plan.code,
        currentPeriodEnd: input.currentPeriodEnd,
      }),
    ]);
    return this.restaurantEntitlements(restaurantId);
  }

  /** The console's "plan dışı açık": one key opened for one restaurant, open ended or until a date. */
  async grantException(
    actorUserId: string,
    restaurantId: string,
    input: CreateEntitlementExceptionInput,
  ): Promise<RestaurantEntitlementsDTO> {
    const exists = await this.prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } });
    if (!exists) throw notFound('NOT_FOUND', 'Restaurant not found');
    const until = input.until ? new Date(input.until) : null;
    if (until && until.getTime() <= Date.now()) throw badRequest('VALIDATION', 'The exception must end in the future');
    const row = await this.prisma.restaurantEntitlement.upsert({
      where: { restaurantId_key_source: { restaurantId, key: input.key, source: 'EXCEPTION' } },
      create: {
        restaurantId,
        key: input.key,
        source: 'EXCEPTION',
        until,
        note: input.note,
        createdByUserId: actorUserId,
      },
      update: { until, note: input.note, createdByUserId: actorUserId },
      select: { id: true },
    });
    await this.audit(actorUserId, restaurantId, 'entitlement.exception_granted', 'restaurant_entitlement', row.id, {
      key: input.key,
      until: input.until,
      note: input.note,
    });
    return this.restaurantEntitlements(restaurantId);
  }

  /** Ends a grant now: an exception, or a grace the platform owner does not want to run out. */
  async revoke(actorUserId: string, restaurantId: string, grantId: string): Promise<RestaurantEntitlementsDTO> {
    const row = await this.prisma.restaurantEntitlement.findFirst({
      where: { id: grantId, restaurantId },
      select: { id: true, key: true, source: true },
    });
    if (!row) throw notFound('ENTITLEMENT_NOT_FOUND', 'Grant not found');
    await this.prisma.$transaction([
      this.prisma.restaurantEntitlement.delete({ where: { id: row.id } }),
      this.audit(actorUserId, restaurantId, 'entitlement.revoked', 'restaurant_entitlement', row.id, {
        key: row.key,
        source: row.source,
      }),
    ]);
    return this.restaurantEntitlements(restaurantId);
  }

  // -- Helpers -------------------------------------------------------------------

  /** One grace row per restaurant now on the plan and removed key, ending with the restaurant's period. */
  private async graceFor(
    planCode: string,
    removed: readonly EntitlementKey[],
    now: Date,
  ): Promise<{ restaurantId: string; key: EntitlementKey; until: Date }[]> {
    const restaurants = await this.prisma.restaurant.findMany({
      select: { id: true, subscription: { select: subscriptionForPlanSelect } },
    });
    const onPlan = restaurants.filter((r) => effectivePlan(subscriptionLike(r.subscription), now) === planCode);
    if (onPlan.length === 0) return [];
    const existing = await this.prisma.restaurantEntitlement.findMany({
      where: { source: 'GRACE', key: { in: [...removed] }, restaurantId: { in: onPlan.map((r) => r.id) } },
      select: { restaurantId: true, key: true, until: true },
    });
    const held = new Map(existing.map((e) => [`${e.restaurantId}:${e.key}`, e.until]));
    const rows: { restaurantId: string; key: EntitlementKey; until: Date }[] = [];
    for (const restaurant of onPlan) {
      const until = this.plans.graceUntil(subscriptionLike(restaurant.subscription), now);
      for (const key of removed) {
        const current = held.get(`${restaurant.id}:${key}`);
        // A grace that already runs longer is kept as it is.
        if (current && current.getTime() >= until.getTime()) continue;
        rows.push({ restaurantId: restaurant.id, key, until });
      }
    }
    return rows;
  }

  private toGrant(row: {
    id: string;
    key: string;
    source: EntitlementSource;
    until: Date | null;
    note: string | null;
    createdAt: Date;
  }): RestaurantEntitlementDTO {
    return {
      id: row.id,
      key: row.key as EntitlementKey,
      source: row.source,
      until: row.until?.toISOString() ?? null,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private audit(
    actorUserId: string,
    restaurantId: string | null,
    action: string,
    entity: string,
    entityId: string | null,
    meta: Prisma.InputJsonValue,
  ) {
    return this.prisma.auditLog.create({ data: { actorUserId, restaurantId, action, entity, entityId, meta } });
  }
}
