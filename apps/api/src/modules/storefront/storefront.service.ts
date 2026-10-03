import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QrScanOutcome } from '@resget/database';
import { DeliveryFeePolicySchema, customerDeliveryFee, dispatchSettingsFrom, trackingUrl } from '@resget/shared';
import type {
  CreateOrderInput,
  MarketplaceAreaDTO,
  MarketplaceDTO,
  MarketplaceQuery,
  PublicOrderInput,
  PublicOrderResultDTO,
  StorefrontDTO,
  StorefrontOrderingDTO,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MenuService } from '../menu/menu.service';
import { MealCardsService } from '../payments/meal-cards.service';
import { CheckoutService } from '../payments/checkout.service';
import { OrdersService } from '../orders/orders.service';
import { CourierService } from '../courier/courier.service';
import { conflict, notFound } from '../../common/api-error';

const restaurantSelect = {
  id: true,
  slug: true,
  name: true,
  currency: true,
  logoUrl: true,
  themePrimary: true,
  defaultLocale: true,
  isActive: true,
  deliveryMode: true,
  deliveryFeePolicy: true,
  dispatchSettings: true,
  branches: {
    where: { isActive: true },
    orderBy: { createdAt: 'asc' as const },
    take: 1,
    select: { id: true, addressLine: true, city: true, district: true, lat: true, lng: true },
  },
} as const;

/** The consumer surface: menus to order from, order placement, the district marketplace (docs/VITRIN.md). */
@Injectable()
export class StorefrontService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menu: MenuService,
    private readonly mealCards: MealCardsService,
    private readonly orders: OrdersService,
    private readonly checkout: CheckoutService,
    private readonly courier: CourierService,
    private readonly config: ConfigService,
  ) {}

  // -- Reads ---------------------------------------------------------------------------

  async byTableToken(token: string, sessionId: string | null): Promise<StorefrontDTO> {
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken: token },
      select: { id: true, label: true, isActive: true, restaurant: { select: restaurantSelect } },
    });
    if (!table || !table.isActive || !table.restaurant.isActive) throw notFound('TABLE_NOT_FOUND', 'Table not found');
    if (sessionId) {
      await this.prisma.qrScanEvent.create({
        data: { restaurantId: table.restaurant.id, tableId: table.id, sessionId, outcome: QrScanOutcome.VIEWED_MENU },
      });
    }
    return this.build(table.restaurant, { id: table.id, label: table.label });
  }

  async bySlug(slug: string): Promise<StorefrontDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { slug }, select: restaurantSelect });
    if (!restaurant || !restaurant.isActive) throw notFound('NOT_FOUND', 'Restaurant not found');
    return this.build(restaurant, null);
  }

  /** The guest put the first item in the basket: the STARTED_ORDER funnel step. */
  async started(token: string, sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken: token },
      select: { id: true, restaurantId: true, isActive: true },
    });
    if (!table || !table.isActive) throw notFound('TABLE_NOT_FOUND', 'Table not found');
    await this.prisma.qrScanEvent.create({
      data: { restaurantId: table.restaurantId, tableId: table.id, sessionId, outcome: QrScanOutcome.STARTED_ORDER },
    });
  }

  async areas(): Promise<MarketplaceAreaDTO[]> {
    return this.prisma.serviceArea.findMany({
      where: { isLaunched: true },
      orderBy: [{ countryCode: 'asc' }, { city: 'asc' }, { district: 'asc' }],
      select: { countryCode: true, city: true, district: true },
    });
  }

  /** Listed restaurants of a launched district: those attached to the area or with a branch in it. */
  async marketplace(query: MarketplaceQuery): Promise<MarketplaceDTO> {
    const area = await this.prisma.serviceArea.findFirst({
      where: {
        countryCode: query.countryCode,
        city: { equals: query.city, mode: 'insensitive' },
        district: { equals: query.district, mode: 'insensitive' },
        isLaunched: true,
      },
      select: { id: true, countryCode: true, city: true, district: true },
    });
    if (!area) throw notFound('NOT_FOUND', 'Service area not found');
    const rows = await this.prisma.restaurant.findMany({
      where: {
        isActive: true,
        isListed: true,
        listingSuspendedAt: null,
        OR: [
          { serviceAreaId: area.id },
          {
            countryCode: area.countryCode,
            branches: {
              some: {
                city: { equals: area.city, mode: 'insensitive' },
                district: { equals: area.district, mode: 'insensitive' },
              },
            },
          },
        ],
      },
      orderBy: { name: 'asc' },
      select: {
        slug: true,
        name: true,
        logoUrl: true,
        themePrimary: true,
        deliveryMode: true,
        branches: { where: { isActive: true }, take: 1, select: { city: true, district: true } },
      },
    });
    return {
      area: { countryCode: area.countryCode, city: area.city, district: area.district },
      restaurants: rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        logoUrl: r.logoUrl,
        themePrimary: r.themePrimary,
        city: r.branches[0]?.city ?? null,
        district: r.branches[0]?.district ?? null,
        delivery: r.deliveryMode !== 'NONE',
        pickup: true,
      })),
    };
  }

  // -- Orders --------------------------------------------------------------------------

  async placeByTableToken(
    token: string,
    input: PublicOrderInput,
    sessionId: string | null,
  ): Promise<PublicOrderResultDTO> {
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken: token },
      select: { id: true, branchId: true, isActive: true, restaurant: { select: restaurantSelect } },
    });
    if (!table || !table.isActive || !table.restaurant.isActive) throw notFound('TABLE_NOT_FOUND', 'Table not found');
    return this.place(table.restaurant, table.branchId, input, {
      channel: 'TABLE_QR',
      tableId: input.fulfillment === 'DINE_IN' ? table.id : undefined,
      sessionId,
    });
  }

  async placeBySlug(slug: string, input: PublicOrderInput): Promise<PublicOrderResultDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { slug }, select: restaurantSelect });
    if (!restaurant || !restaurant.isActive) throw notFound('NOT_FOUND', 'Restaurant not found');
    if (input.fulfillment === 'DINE_IN') throw conflict('ORDER_TRANSITION_INVALID', 'Dine-in orders need a table QR');
    const branch = restaurant.branches[0];
    if (!branch) throw notFound('NOT_FOUND', 'Restaurant has no branch');
    return this.place(restaurant, branch.id, input, {
      channel: 'RESTAURANT_SITE',
      tableId: undefined,
      sessionId: null,
    });
  }

  private async place(
    restaurant: RestaurantRow,
    branchId: string,
    input: PublicOrderInput,
    context: { channel: 'TABLE_QR' | 'RESTAURANT_SITE'; tableId: string | undefined; sessionId: string | null },
  ): Promise<PublicOrderResultDTO> {
    const ordering = this.orderingOf(restaurant, context.tableId !== undefined);
    if (input.fulfillment === 'DELIVERY' && !ordering.delivery)
      throw conflict('ORDER_TRANSITION_INVALID', 'No delivery here');
    if (input.fulfillment === 'DINE_IN' && !context.tableId) throw conflict('ORDER_TRANSITION_INVALID', 'No table');

    const deliveryFeeMinor =
      input.fulfillment === 'DELIVERY' && input.address ? await this.deliveryFee(restaurant, branchId, input) : 0;

    const create: CreateOrderInput = {
      branchId,
      channel: context.channel,
      fulfillment: input.fulfillment,
      tableId: context.tableId,
      customer: input.customer,
      items: input.items,
      address: input.address,
      deliveryFeeMinor,
      payment: input.payment,
      note: input.note,
      qrSessionId: context.sessionId ?? undefined,
      marketingOptIn: input.marketingOptIn,
    };
    const order = await this.orders.create(restaurant.id, create, null, false);
    const token = order.trackingUrl.split('/t/')[1] ?? '';
    let checkoutUrl: string | null = null;
    if (order.status === 'PENDING_PAYMENT' && input.returnUrl) {
      const session = await this.checkout.startPublicCheckout(token, input.returnUrl);
      checkoutUrl = session.session.redirectUrl;
    }
    return {
      trackingToken: token,
      trackingUrl: trackingUrl(this.config.getOrThrow<string>('PUBLIC_APP_URL'), token),
      shortCode: order.shortCode,
      status: order.status,
      fulfillment: order.fulfillment,
      chargedToCustomerMinor: order.chargedToCustomerMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      currency: order.currency,
      checkoutUrl,
    };
  }

  /**
   * Own courier: the restaurant's policy on a zero quote. Courier network: the
   * network's quote through the policy. A network cannot quote without
   * coordinates on both ends; the policy then applies on a zero quote, which
   * is the honest fee until the address is geocoded (docs/VITRIN.md).
   */
  private async deliveryFee(restaurant: RestaurantRow, branchId: string, input: PublicOrderInput): Promise<number> {
    const basketMinor = await this.basketMinor(restaurant.id, input);
    const policy = DeliveryFeePolicySchema.safeParse(restaurant.deliveryFeePolicy);
    const fallback = policy.success ? customerDeliveryFee(0, basketMinor, policy.data) : 0;
    if (restaurant.deliveryMode !== 'THIRD_PARTY_API') return fallback;
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { addressLine: true, city: true, district: true, lat: true, lng: true, phone: true },
    });
    const address = input.address;
    if (!address || !address.point || branch.lat === null || branch.lng === null) return fallback;
    const quoted = await this.courier.quoteFor(
      restaurant.id,
      {
        pickup: {
          address: [branch.addressLine, branch.district, branch.city].join(', '),
          point: { lat: branch.lat, lng: branch.lng },
          contactName: restaurant.name,
          contactPhone: branch.phone ?? address.contactPhone,
        },
        dropoff: {
          address: [address.addressLine, address.district, address.city].join(', '),
          point: address.point,
          contactName: address.contactName,
          contactPhone: address.contactPhone,
          note: address.note,
        },
        parcelValueMinor: basketMinor,
        currency: restaurant.currency,
      },
      basketMinor,
    );
    return quoted.customerFeeMinor;
  }

  private async basketMinor(restaurantId: string, input: PublicOrderInput): Promise<number> {
    const items = await this.prisma.menuItem.findMany({
      where: { restaurantId, id: { in: input.items.map((l) => l.menuItemId) } },
      select: { id: true, priceMinor: true },
    });
    const price = new Map(items.map((i) => [i.id, i.priceMinor]));
    return input.items.reduce((sum, line) => {
      const unit = (price.get(line.menuItemId) ?? 0) + line.modifiers.reduce((m, x) => m + x.priceDeltaMinor, 0);
      return sum + unit * line.quantity;
    }, 0);
  }

  // -- Helpers -------------------------------------------------------------------------

  private async build(restaurant: RestaurantRow, table: { id: string; label: string } | null): Promise<StorefrontDTO> {
    const [categories, payment] = await Promise.all([
      this.menu.menuOf(restaurant.id),
      this.mealCards.acceptedMethods(restaurant.id),
    ]);
    return {
      restaurant: {
        id: restaurant.id,
        slug: restaurant.slug,
        name: restaurant.name,
        currency: restaurant.currency,
        logoUrl: restaurant.logoUrl,
        themePrimary: restaurant.themePrimary,
        defaultLocale: restaurant.defaultLocale,
      },
      table,
      payment,
      ordering: this.orderingOf(restaurant, table !== null),
      categories,
    };
  }

  private orderingOf(restaurant: RestaurantRow, hasTable: boolean): StorefrontOrderingDTO {
    const policy = DeliveryFeePolicySchema.safeParse(restaurant.deliveryFeePolicy);
    return {
      dineIn: hasTable,
      pickup: true,
      delivery: restaurant.deliveryMode !== 'NONE' && restaurant.branches.length > 0,
      deliveryFeePolicy: policy.success ? policy.data : null,
      quotedDelivery: restaurant.deliveryMode === 'THIRD_PARTY_API',
      defaultPrepMinutes: dispatchSettingsFrom(restaurant.dispatchSettings).defaultPrepMinutes,
    };
  }
}

interface RestaurantRow {
  id: string;
  slug: string;
  name: string;
  currency: string;
  logoUrl: string | null;
  themePrimary: string;
  defaultLocale: string;
  isActive: boolean;
  deliveryMode: 'RESTAURANT_COURIER' | 'THIRD_PARTY_API' | 'NONE';
  deliveryFeePolicy: unknown;
  dispatchSettings: unknown;
  branches: {
    id: string;
    addressLine: string;
    city: string;
    district: string;
    lat: number | null;
    lng: number | null;
  }[];
}
