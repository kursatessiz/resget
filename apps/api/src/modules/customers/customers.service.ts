import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { LoyaltyProgramSchema, loyaltyTierFor, maskPhoneForDisplay } from '@resget/shared';
import type { CustomerDTO, CustomerPageDTO, CustomersQuery, LoyaltyTier, UpdateCustomerInput } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../../common/api-error';

const customerSelect = Prisma.validator<Prisma.RestaurantCustomerSelect>()({
  id: true,
  userId: true,
  firstChannel: true,
  firstOrderAt: true,
  lastOrderAt: true,
  orderCount: true,
  lifetimeGrossMinor: true,
  tags: true,
  note: true,
  marketingOptIn: true,
  loyaltyPoints: true,
  createdAt: true,
  user: { select: { fullName: true, phone: true } },
});
type CustomerRow = Prisma.RestaurantCustomerGetPayload<{ select: typeof customerSelect }>;

const DAY_MS = 86_400_000;

/** The restaurant's own customer list (docs/PANEL.md); the SaaS lock-in and the audience of future campaigns. */
const restaurantSelect = { currency: true, loyaltyProgram: { select: { tiers: true } } } as const;
type RestaurantRow = Prisma.RestaurantGetPayload<{ select: typeof restaurantSelect }>;

/** The restaurant's loyalty tiers (docs/SADAKAT.md, "Seviyeler"); none when unreadable or not set. */
function tiersOf(value: Prisma.JsonValue | undefined): LoyaltyTier[] {
  const parsed = LoyaltyProgramSchema.shape.tiers.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(restaurantId: string, query: CustomersQuery, canSeeContacts: boolean): Promise<CustomerPageDTO> {
    // A customer who deleted their account leaves the list; the row stays for the restaurant's figures.
    const where: Prisma.RestaurantCustomerWhereInput = {
      AND: [{ user: { deletedAt: null } }],
      restaurantId,
      ...(query.query
        ? {
            user: {
              OR: [
                { fullName: { contains: query.query, mode: 'insensitive' } },
                { phone: { contains: query.query.replace(/\s+/g, '') } },
              ],
            },
          }
        : {}),
    };
    const orderBy: Prisma.RestaurantCustomerOrderByWithRelationInput[] =
      query.sort === 'orders'
        ? [{ orderCount: 'desc' }, { lastOrderAt: 'desc' }]
        : query.sort === 'spend'
          ? [{ lifetimeGrossMinor: 'desc' }, { lastOrderAt: 'desc' }]
          : [{ lastOrderAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
    const since = new Date(Date.now() - 30 * DAY_MS);
    const [restaurant, rows, total, all, fresh, returning] = await Promise.all([
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: restaurantSelect }),
      this.prisma.restaurantCustomer.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: customerSelect,
      }),
      this.prisma.restaurantCustomer.count({ where }),
      this.prisma.restaurantCustomer.count({ where: { restaurantId } }),
      this.prisma.restaurantCustomer.count({ where: { restaurantId, createdAt: { gte: since } } }),
      this.prisma.restaurantCustomer.count({ where: { restaurantId, orderCount: { gt: 1 } } }),
    ]);
    return {
      items: rows.map((row) => this.toDto(row, restaurant, canSeeContacts)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      summary: { total: all, newLast30Days: fresh, returning },
    };
  }

  async get(restaurantId: string, customerId: string, canSeeContacts: boolean): Promise<CustomerDTO> {
    const [restaurant, row] = await Promise.all([
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: restaurantSelect }),
      this.prisma.restaurantCustomer.findFirst({
        where: { id: customerId, restaurantId, user: { deletedAt: null } },
        select: customerSelect,
      }),
    ]);
    if (!row) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
    return this.toDto(row, restaurant, canSeeContacts);
  }

  /** Notes and tags: the restaurant's own words about its customer, never shown to the customer. */
  async update(
    restaurantId: string,
    customerId: string,
    input: UpdateCustomerInput,
    canSeeContacts: boolean,
  ): Promise<CustomerDTO> {
    const existing = await this.prisma.restaurantCustomer.findFirst({
      where: { id: customerId, restaurantId },
      select: { id: true },
    });
    if (!existing) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
    await this.prisma.restaurantCustomer.update({
      where: { id: customerId },
      data: {
        ...(input.tags !== undefined ? { tags: [...new Set(input.tags)] } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
    return this.get(restaurantId, customerId, canSeeContacts);
  }

  private toDto(row: CustomerRow, restaurant: RestaurantRow, canSeeContacts: boolean): CustomerDTO {
    const currency = restaurant.currency;
    return {
      id: row.id,
      userId: row.userId,
      fullName: row.user.fullName,
      phone: canSeeContacts ? row.user.phone : maskPhoneForDisplay(row.user.phone),
      firstChannel: row.firstChannel,
      firstOrderAt: row.firstOrderAt?.toISOString() ?? null,
      lastOrderAt: row.lastOrderAt?.toISOString() ?? null,
      orderCount: row.orderCount,
      lifetimeGrossMinor: row.lifetimeGrossMinor,
      currency,
      tags: row.tags,
      note: row.note,
      marketingOptIn: row.marketingOptIn,
      loyaltyPoints: row.loyaltyPoints,
      loyaltyTier:
        loyaltyTierFor(tiersOf(restaurant.loyaltyProgram?.tiers), row.lifetimeGrossMinor).current?.name ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
