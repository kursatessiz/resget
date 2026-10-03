import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import type {
  AdminCreateRestaurantInput,
  AdminCreditPackageDTO,
  AdminOverviewDTO,
  AdminRestaurantDTO,
  AdminRestaurantPageDTO,
  AdminRestaurantQuery,
  AdminRestaurantUpdateInput,
  CreateServiceAreaInput,
  CreditChannel,
  DistrictDensityDTO,
  GrantCreditsInput,
  GrantCreditsResultDTO,
  PlanCode,
  PlanDTO,
  RestaurantCreatedDTO,
  ServiceAreaDTO,
  UpdatePlanInput,
  UpsertCreditPackageInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { RestaurantProvisioningService } from '../restaurants/provisioning.service';
import { conflict, notFound } from '../../common/api-error';

const restaurantSelect = Prisma.validator<Prisma.RestaurantSelect>()({
  id: true,
  slug: true,
  name: true,
  countryCode: true,
  currency: true,
  isActive: true,
  isListed: true,
  commissionBps: true,
  paymentMode: true,
  pspPercentBps: true,
  pspFixedMinor: true,
  createdAt: true,
  serviceArea: { select: { id: true, city: true, district: true, isLaunched: true } },
  branches: { take: 1, orderBy: { createdAt: 'asc' }, select: { city: true, district: true } },
  subscription: { select: { status: true, trialEndsAt: true, plan: { select: { code: true } } } },
  memberships: {
    where: { roleTemplate: { isOwner: true } },
    take: 1,
    select: { user: { select: { fullName: true, phone: true } } },
  },
});
type RestaurantRow = Prisma.RestaurantGetPayload<{ select: typeof restaurantSelect }>;

const DAY_MS = 86_400_000;

/** The platform owner's console (docs/PLATFORM_YONETIMI.md). Every write leaves an audit row. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly provisioning: RestaurantProvisioningService,
  ) {}

  // -- Restaurants ---------------------------------------------------------------------

  async listRestaurants(query: AdminRestaurantQuery): Promise<AdminRestaurantPageDTO> {
    const where: Prisma.RestaurantWhereInput = {
      ...(query.listed ? { isListed: query.listed === 'true' } : {}),
      ...(query.query
        ? {
            OR: [
              { name: { contains: query.query, mode: 'insensitive' } },
              { slug: { contains: query.query, mode: 'insensitive' } },
              { branches: { some: { district: { contains: query.query, mode: 'insensitive' } } } },
              { branches: { some: { city: { contains: query.query, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: restaurantSelect,
      }),
      this.prisma.restaurant.count({ where }),
    ]);
    const counts = await this.ordersLast7Days(rows.map((r) => r.id));
    return {
      items: rows.map((r) => this.toRestaurant(r, counts.get(r.id) ?? 0)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getRestaurant(id: string): Promise<AdminRestaurantDTO> {
    const row = await this.prisma.restaurant.findUnique({ where: { id }, select: restaurantSelect });
    if (!row) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
    const counts = await this.ordersLast7Days([id]);
    return this.toRestaurant(row, counts.get(id) ?? 0);
  }

  async createRestaurant(actorUserId: string, input: AdminCreateRestaurantInput): Promise<RestaurantCreatedDTO> {
    const { ownerPhone, ownerName, ...restaurant } = input;
    const owner = await this.prisma.user.upsert({
      where: { phone: ownerPhone },
      update: {},
      create: { phone: ownerPhone, fullName: ownerName },
      select: { id: true, fullName: true, phone: true },
    });
    if (owner.fullName === owner.phone) {
      await this.prisma.user.update({ where: { id: owner.id }, data: { fullName: ownerName } });
    }
    return this.provisioning.create(owner.id, restaurant, actorUserId);
  }

  async updateRestaurant(
    actorUserId: string,
    id: string,
    input: AdminRestaurantUpdateInput,
  ): Promise<AdminRestaurantDTO> {
    const existing = await this.prisma.restaurant.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
    if (input.serviceAreaId) {
      const area = await this.prisma.serviceArea.findUnique({
        where: { id: input.serviceAreaId },
        select: { id: true },
      });
      if (!area) throw notFound('NOT_FOUND', 'Service area not found');
    }
    const { serviceAreaId, ...scalars } = input;
    await this.prisma.$transaction([
      this.prisma.restaurant.update({
        where: { id },
        data: {
          ...scalars,
          ...(serviceAreaId !== undefined
            ? { serviceArea: serviceAreaId ? { connect: { id: serviceAreaId } } : { disconnect: true } }
            : {}),
        },
      }),
      this.audit(actorUserId, id, 'restaurant.updated', 'restaurant', id, input as Prisma.InputJsonObject),
    ]);
    return this.getRestaurant(id);
  }

  async grantCredits(
    actorUserId: string,
    restaurantId: string,
    input: GrantCreditsInput,
  ): Promise<GrantCreditsResultDTO> {
    const existing = await this.prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } });
    if (!existing) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
    const wallets = await this.messaging.grant(
      restaurantId,
      input.channel,
      input.credits,
      'GRANT',
      `admin:${input.note}`,
    );
    await this.audit(
      actorUserId,
      restaurantId,
      'credits.granted',
      'message_wallet',
      null,
      input as unknown as Prisma.InputJsonObject,
    );
    const wallet = wallets.find((w) => w.channel === input.channel);
    return { channel: input.channel, balance: wallet?.balance ?? 0 };
  }

  // -- Service areas -------------------------------------------------------------------

  async listServiceAreas(): Promise<ServiceAreaDTO[]> {
    const rows = await this.prisma.serviceArea.findMany({
      orderBy: [{ countryCode: 'asc' }, { city: 'asc' }, { district: 'asc' }],
      include: { _count: { select: { restaurants: true } } },
    });
    const listed = await this.prisma.restaurant.groupBy({
      by: ['serviceAreaId'],
      where: { isListed: true, serviceAreaId: { not: null } },
      _count: { _all: true },
    });
    const listedBy = new Map(listed.map((l) => [l.serviceAreaId, l._count._all]));
    return rows.map((r) => ({
      id: r.id,
      countryCode: r.countryCode,
      city: r.city,
      district: r.district,
      isLaunched: r.isLaunched,
      launchedAt: r.launchedAt ? r.launchedAt.toISOString() : null,
      restaurants: r._count.restaurants,
      listedRestaurants: listedBy.get(r.id) ?? 0,
    }));
  }

  async createServiceArea(actorUserId: string, input: CreateServiceAreaInput): Promise<ServiceAreaDTO> {
    try {
      const row = await this.prisma.serviceArea.create({ data: input, select: { id: true } });
      await this.audit(actorUserId, null, 'service_area.created', 'service_area', row.id, input);
      // Restaurants that signed up in the district before the area existed are attached now.
      await this.prisma.restaurant.updateMany({
        where: {
          serviceAreaId: null,
          countryCode: input.countryCode,
          branches: {
            some: {
              city: { equals: input.city, mode: 'insensitive' },
              district: { equals: input.district, mode: 'insensitive' },
            },
          },
        },
        data: { serviceAreaId: row.id },
      });
      return (await this.listServiceAreas()).find((a) => a.id === row.id)!;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('SERVICE_AREA_EXISTS', 'Service area already exists');
      }
      throw error;
    }
  }

  async setServiceAreaLaunch(actorUserId: string, id: string, isLaunched: boolean): Promise<ServiceAreaDTO> {
    const area = await this.prisma.serviceArea.findUnique({ where: { id }, select: { id: true, launchedAt: true } });
    if (!area) throw notFound('NOT_FOUND', 'Service area not found');
    await this.prisma.$transaction([
      this.prisma.serviceArea.update({
        where: { id },
        data: { isLaunched, launchedAt: isLaunched ? (area.launchedAt ?? new Date()) : area.launchedAt },
      }),
      this.audit(actorUserId, null, isLaunched ? 'service_area.launched' : 'service_area.closed', 'service_area', id, {
        isLaunched,
      }),
    ]);
    return (await this.listServiceAreas()).find((a) => a.id === id)!;
  }

  // -- Plans and packages --------------------------------------------------------------

  async listPlans(): Promise<PlanDTO[]> {
    const rows = await this.prisma.plan.findMany({
      orderBy: { monthlyPriceMinor: 'asc' },
      include: { _count: { select: { subscriptions: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      code: p.code as PlanCode,
      name: p.name,
      monthlyPriceMinor: p.monthlyPriceMinor,
      currency: p.currency,
      isFree: p.isFree,
      trialDays: p.trialDays,
      isActive: p.isActive,
      subscriptions: p._count.subscriptions,
    }));
  }

  async updatePlan(actorUserId: string, id: string, input: UpdatePlanInput): Promise<PlanDTO> {
    const plan = await this.prisma.plan.findUnique({ where: { id }, select: { id: true } });
    if (!plan) throw notFound('PLAN_NOT_FOUND', 'Plan not found');
    await this.prisma.$transaction([
      this.prisma.plan.update({ where: { id }, data: input }),
      this.audit(actorUserId, null, 'plan.updated', 'plan', id, input as Prisma.InputJsonObject),
    ]);
    return (await this.listPlans()).find((p) => p.id === id)!;
  }

  async listCreditPackages(): Promise<AdminCreditPackageDTO[]> {
    const rows = await this.prisma.messageCreditPackage.findMany({ orderBy: [{ channel: 'asc' }, { credits: 'asc' }] });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      channel: r.channel as CreditChannel,
      credits: r.credits,
      priceMinor: r.priceMinor,
      currency: r.currency,
      isActive: r.isActive,
    }));
  }

  async upsertCreditPackage(actorUserId: string, input: UpsertCreditPackageInput): Promise<AdminCreditPackageDTO> {
    const { code, ...rest } = input;
    const row = await this.prisma.messageCreditPackage.upsert({
      where: { code },
      update: rest,
      create: { code, ...rest },
      select: { id: true },
    });
    await this.audit(actorUserId, null, 'credit_package.upserted', 'message_credit_package', row.id, input);
    return (await this.listCreditPackages()).find((p) => p.id === row.id)!;
  }

  // -- Overview and density ------------------------------------------------------------

  async overview(days: number): Promise<AdminOverviewDTO> {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [restaurants, listedRestaurants, activeTrials, ordersLast7Days, density] = await Promise.all([
      this.prisma.restaurant.count({ where: { isActive: true } }),
      this.prisma.restaurant.count({ where: { isActive: true, isListed: true } }),
      this.prisma.restaurantSubscription.count({ where: { status: 'TRIALING', trialEndsAt: { gt: new Date() } } }),
      this.prisma.order.count({ where: { placedAt: { gte: since }, status: { notIn: ['PENDING_PAYMENT'] } } }),
      this.density(days),
    ]);
    return { restaurants, listedRestaurants, activeTrials, ordersLast7Days, density };
  }

  /** Orders per active restaurant per day, grouped by the branch's district (service area when assigned). */
  async density(days: number): Promise<DistrictDensityDTO[]> {
    const since = new Date(Date.now() - days * DAY_MS);
    const branches = await this.prisma.branch.findMany({
      where: { restaurant: { isActive: true } },
      select: {
        id: true,
        city: true,
        district: true,
        restaurantId: true,
        restaurant: { select: { countryCode: true, isListed: true } },
      },
    });
    const ordersByBranch = await this.prisma.order.groupBy({
      by: ['branchId'],
      where: { placedAt: { gte: since }, status: { notIn: ['PENDING_PAYMENT'] } },
      _count: { _all: true },
    });
    const orderCount = new Map(ordersByBranch.map((o) => [o.branchId, o._count._all]));
    const areas = await this.prisma.serviceArea.findMany({
      select: { countryCode: true, city: true, district: true, isLaunched: true },
    });
    const launched = new Set(areas.filter((a) => a.isLaunched).map((a) => key(a.countryCode, a.city, a.district)));

    const buckets = new Map<
      string,
      {
        countryCode: string;
        city: string;
        district: string;
        restaurants: Set<string>;
        listed: Set<string>;
        orders: number;
      }
    >();
    for (const branch of branches) {
      const k = key(branch.restaurant.countryCode, branch.city, branch.district);
      const bucket = buckets.get(k) ?? {
        countryCode: branch.restaurant.countryCode,
        city: branch.city,
        district: branch.district,
        restaurants: new Set<string>(),
        listed: new Set<string>(),
        orders: 0,
      };
      bucket.restaurants.add(branch.restaurantId);
      if (branch.restaurant.isListed) bucket.listed.add(branch.restaurantId);
      bucket.orders += orderCount.get(branch.id) ?? 0;
      buckets.set(k, bucket);
    }
    return [...buckets.entries()]
      .map(([k, b]) => ({
        countryCode: b.countryCode,
        city: b.city,
        district: b.district,
        isLaunched: launched.has(k),
        restaurants: b.restaurants.size,
        listedRestaurants: b.listed.size,
        orders: b.orders,
        days,
        ordersPerRestaurantPerDay:
          b.restaurants.size === 0 ? 0 : Math.round((b.orders / b.restaurants.size / days) * 100) / 100,
      }))
      .sort((a, b) => b.ordersPerRestaurantPerDay - a.ordersPerRestaurantPerDay);
  }

  // -- Helpers -------------------------------------------------------------------------

  private async ordersLast7Days(restaurantIds: string[]): Promise<Map<string, number>> {
    if (restaurantIds.length === 0) return new Map();
    const rows = await this.prisma.order.groupBy({
      by: ['restaurantId'],
      where: {
        restaurantId: { in: restaurantIds },
        placedAt: { gte: new Date(Date.now() - 7 * DAY_MS) },
        status: { notIn: ['PENDING_PAYMENT'] },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.restaurantId, r._count._all]));
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

  private toRestaurant(row: RestaurantRow, ordersLast7Days: number): AdminRestaurantDTO {
    const owner = row.memberships[0]?.user ?? null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      countryCode: row.countryCode,
      currency: row.currency,
      city: row.branches[0]?.city ?? null,
      district: row.branches[0]?.district ?? null,
      serviceArea: row.serviceArea,
      isActive: row.isActive,
      isListed: row.isListed,
      commissionBps: row.commissionBps,
      paymentMode: row.paymentMode,
      pspPercentBps: row.pspPercentBps,
      pspFixedMinor: row.pspFixedMinor,
      plan: row.subscription
        ? {
            code: row.subscription.plan.code as PlanCode,
            status: row.subscription.status,
            trialEndsAt: row.subscription.trialEndsAt ? row.subscription.trialEndsAt.toISOString() : null,
          }
        : null,
      owner,
      ordersLast7Days,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function key(countryCode: string, city: string, district: string): string {
  return `${countryCode}|${city.toLocaleLowerCase('tr')}|${district.toLocaleLowerCase('tr')}`;
}
