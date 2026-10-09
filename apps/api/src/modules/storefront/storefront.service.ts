import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QrScanOutcome } from '@resget/database';
import {
  DeliveryFeePolicySchema,
  customerDeliveryFee,
  zoneDeliveryFee,
  dispatchSettingsFrom,
  isOpenAt,
  rankRestaurants,
  ratingSummary,
  trackingUrl,
} from '@resget/shared';
import type {
  CreateOrderInput,
  DeliveryZone,
  MarketplaceAreaDTO,
  MarketplaceDTO,
  MarketplaceInterestInput,
  MarketplaceInterestResultDTO,
  MarketplaceQuery,
  PublicOrderInput,
  PublicOrderResultDTO,
  StorefrontDTO,
  StorefrontOrderingDTO,
} from '@resget/shared';
import { AvailabilityService, availabilitySelect } from '../availability/availability.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { DeliveryZoneService } from '../restaurants/delivery-zone.service';
import { AttributionService } from '../attribution/attribution.service';
import { CouponsService } from '../coupons/coupons.service';
import { PrismaService } from '../prisma/prisma.service';
import { MenuService } from '../menu/menu.service';
import { MealCardsService } from '../payments/meal-cards.service';
import { CheckoutService } from '../payments/checkout.service';
import { WalletsService } from '../payments/wallets.service';
import { OrdersService } from '../orders/orders.service';
import { CourierService } from '../courier/courier.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import type { AuthUser } from '../auth/tenant-context';
import { badRequest, conflict, notFound } from '../../common/api-error';
import { TabsService } from '../tabs/tabs.service';

const restaurantSelect = {
  ...availabilitySelect,
  isPlatform: true,
  slug: true,
  name: true,
  currency: true,
  countryCode: true,
  logoUrl: true,
  themePrimary: true,
  defaultLocale: true,
  isActive: true,
  deliveryMode: true,
  deliveryFeePolicy: true,
  deliveryZone: true,
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
    private readonly wallets: WalletsService,
    private readonly courier: CourierService,
    private readonly loyalty: LoyaltyService,
    private readonly geocoding: GeocodingService,
    private readonly config: ConfigService,
    private readonly features: FeatureFlagsService,
    private readonly availability: AvailabilityService,
    private readonly zones: DeliveryZoneService,
    private readonly coupons: CouponsService,
    private readonly attribution: AttributionService,
    private readonly tabs: TabsService,
  ) {}

  // -- Reads ---------------------------------------------------------------------------

  async byTableToken(token: string, sessionId: string | null): Promise<StorefrontDTO> {
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken: token },
      select: { id: true, label: true, branchId: true, isActive: true, restaurant: { select: restaurantSelect } },
    });
    if (!table || !table.isActive || !table.restaurant.isActive) throw notFound('TABLE_NOT_FOUND', 'Table not found');
    await this.features.assertEnabled('table_qr', table.restaurant.id);
    if (sessionId) {
      await this.recordStep(table.restaurant.id, table.id, sessionId, QrScanOutcome.VIEWED_MENU);
    }
    return this.build(table.restaurant, { id: table.id, label: table.label }, table.branchId);
  }

  async bySlug(slug: string): Promise<StorefrontDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { slug }, select: restaurantSelect });
    if (!restaurant || !restaurant.isActive || restaurant.isPlatform)
      throw notFound('NOT_FOUND', 'Restaurant not found');
    return this.build(restaurant, null, restaurant.branches[0]?.id ?? null);
  }

  /** The guest put the first item in the basket: the STARTED_ORDER funnel step. */
  async started(token: string, sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken: token },
      select: { id: true, restaurantId: true, isActive: true },
    });
    if (!table || !table.isActive) throw notFound('TABLE_NOT_FOUND', 'Table not found');
    await this.features.assertEnabled('table_qr', table.restaurantId);
    await this.recordStep(table.restaurantId, table.id, sessionId, QrScanOutcome.STARTED_ORDER);
  }

  /**
   * One funnel row per session, table and step a day: the funnel counts sessions, so a menu reloaded or polled does
   * not add rows (the table would otherwise grow with every page view), while a guest back on another day still
   * counts in that day's funnel.
   */
  private async recordStep(restaurantId: string, tableId: string, sessionId: string, outcome: QrScanOutcome) {
    const seen = await this.prisma.qrScanEvent.findFirst({
      where: { restaurantId, tableId, sessionId, outcome, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
      select: { id: true },
    });
    if (seen) return;
    await this.prisma.qrScanEvent.create({ data: { restaurantId, tableId, sessionId, outcome } });
  }

  async areas(): Promise<MarketplaceAreaDTO[]> {
    return this.prisma.serviceArea.findMany({
      where: { isLaunched: true },
      orderBy: [{ countryCode: 'asc' }, { city: 'asc' }, { district: 'asc' }],
      select: { countryCode: true, city: true, district: true },
    });
  }

  /** Listed restaurants of a launched district: those attached to the area or with a branch in it. */
  /** A visitor asks for a district that is not open yet; one counter per district, read by the console. */
  async interest(input: MarketplaceInterestInput): Promise<MarketplaceInterestResultDTO> {
    const launched = await this.prisma.serviceArea.findFirst({
      where: {
        countryCode: input.countryCode,
        city: { equals: input.city, mode: 'insensitive' },
        district: { equals: input.district, mode: 'insensitive' },
        isLaunched: true,
      },
      select: { id: true },
    });
    if (launched) return { recorded: false, launched: true };
    const city = input.city.trim();
    const district = input.district.trim();
    await this.prisma.marketplaceInterest.upsert({
      where: { countryCode_city_district: { countryCode: input.countryCode, city, district } },
      update: { count: { increment: 1 } },
      create: { countryCode: input.countryCode, city, district, count: 1 },
    });
    return { recorded: true, launched: false };
  }

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
    const listed = await this.prisma.restaurant.findMany({
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
      select: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        themePrimary: true,
        deliveryMode: true,
        timezone: true,
        ordersPausedUntil: true,
        branches: { where: { isActive: true }, take: 1, select: { city: true, district: true, openingHours: true } },
        ratingCount: true,
        ratingSum: true,
      },
    });
    // Only restaurants whose marketplace module is on are listed (docs/OZELLIK_ANAHTARLARI.md).
    const shown = await Promise.all(listed.map((r) => this.features.isEnabled('marketplace', r.id)));
    const rows = listed.filter((_, index) => shown[index]);
    // A paused restaurant reads as closed while the availability module is on for it.
    const availabilityOn = await Promise.all(rows.map((r) => this.features.isEnabled('order_availability', r.id)));
    // Ranking (docs/VITRIN.md): open now first, then a damped rating and recent completed orders, then the name.
    const now = new Date();
    const recent = await this.prisma.order.groupBy({
      by: ['restaurantId'],
      where: {
        restaurantId: { in: rows.map((r) => r.id) },
        status: { in: ['DELIVERED', 'PICKED_UP'] },
        completedAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
      },
      _count: { _all: true },
    });
    const recentBy = new Map(recent.map((r) => [r.restaurantId, r._count._all]));
    const ranked = rankRestaurants(
      rows.map((r, index) => ({
        ...r,
        isOpenNow:
          availabilityOn[index] && r.ordersPausedUntil !== null && r.ordersPausedUntil > now
            ? false
            : isOpenAt(r.branches[0]?.openingHours ?? null, now, r.timezone),
        recentOrders: recentBy.get(r.id) ?? 0,
      })),
    );
    return {
      area: { countryCode: area.countryCode, city: area.city, district: area.district },
      restaurants: ranked.map((r) => ({
        rating: ratingSummary(r.ratingSum, r.ratingCount),
        isOpenNow: r.isOpenNow,
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
    viewer: AuthUser | null = null,
    visitorId: string | null = null,
  ): Promise<PublicOrderResultDTO> {
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken: token },
      select: { id: true, branchId: true, isActive: true, restaurant: { select: restaurantSelect } },
    });
    if (!table || !table.isActive || !table.restaurant.isActive) throw notFound('TABLE_NOT_FOUND', 'Table not found');
    await this.features.assertEnabled('table_qr', table.restaurant.id);
    return this.place(table.restaurant, table.branchId, input, {
      channel: 'TABLE_QR',
      tableId: input.fulfillment === 'DINE_IN' ? table.id : undefined,
      sessionId,
      viewer,
      visitorId,
    });
  }

  async placeBySlug(
    slug: string,
    input: PublicOrderInput,
    viewer: AuthUser | null = null,
    visitorId: string | null = null,
  ): Promise<PublicOrderResultDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { slug }, select: restaurantSelect });
    if (!restaurant || !restaurant.isActive || restaurant.isPlatform)
      throw notFound('NOT_FOUND', 'Restaurant not found');
    if (input.fulfillment === 'DINE_IN') throw conflict('ORDER_TRANSITION_INVALID', 'Dine-in orders need a table QR');
    const branch = restaurant.branches[0];
    if (!branch) throw notFound('NOT_FOUND', 'Restaurant has no branch');
    return this.place(restaurant, branch.id, input, {
      channel: 'RESTAURANT_SITE',
      tableId: undefined,
      sessionId: null,
      viewer,
      visitorId,
    });
  }

  private async place(
    restaurant: RestaurantRow,
    branchId: string,
    input: PublicOrderInput,
    context: {
      channel: 'TABLE_QR' | 'RESTAURANT_SITE';
      tableId: string | undefined;
      sessionId: string | null;
      viewer: AuthUser | null;
      /** The measured browser that placed the order (docs/ATIF.md); links its visits to the customer. */
      visitorId: string | null;
    },
  ): Promise<PublicOrderResultDTO> {
    // Paused or outside the hours: consumer orders wait (docs/SIPARIS_VE_SEVK.md, "Sipariş alma durumu").
    // A pre-order for an offered slot is taken while closed (docs/ILERI_TARIHLI_SIPARIS.md).
    if (input.scheduledFor) {
      if (context.tableId !== undefined) throw badRequest('SCHEDULED_SLOT_INVALID', 'A table order is never scheduled');
      await this.availability.assertScheduledSlot(restaurant, branchId, new Date(input.scheduledFor));
    } else {
      await this.availability.assertAccepting(restaurant, branchId);
    }
    // Breakfast only in the morning: each item's category must be served when the order is for (docs/OGUN_SAATLERI.md).
    const notServed = await this.menu.itemsNotServedAt(
      restaurant.id,
      input.items.map((line) => line.menuItemId),
      input.scheduledFor ? new Date(input.scheduledFor) : new Date(),
      restaurant.timezone,
    );
    if (notServed.length > 0) {
      throw conflict('MENU_ITEM_NOT_SERVED', `Not served at this time: ${notServed.join(', ')}`);
    }
    const zone = input.fulfillment === 'DELIVERY' ? await this.zones.activeZone(restaurant) : null;
    const ordering = this.orderingOf(restaurant, context.tableId !== undefined, zone, false);
    if (input.fulfillment === 'DELIVERY' && !ordering.delivery)
      throw conflict('ORDER_TRANSITION_INVALID', 'No delivery here');
    if (input.fulfillment === 'DINE_IN' && !context.tableId) throw conflict('ORDER_TRANSITION_INVALID', 'No table');
    if (input.tab && !context.tableId) throw conflict('ORDER_TRANSITION_INVALID', 'A tab belongs to a table');

    // The quote and the routing need a point; an address typed without one is geocoded first (docs/VITRIN.md).
    if (input.fulfillment === 'DELIVERY' && input.address && !input.address.point) {
      const branch = restaurant.branches.find((b) => b.id === branchId) ?? restaurant.branches[0];
      const near = branch && branch.lat !== null && branch.lng !== null ? { lat: branch.lat, lng: branch.lng } : null;
      input = {
        ...input,
        address: {
          ...input.address,
          point: await this.geocoding.pointFor(input.address, restaurant.countryCode, near),
        },
      };
    }
    const deliveryFeeMinor =
      input.fulfillment === 'DELIVERY' && input.address ? await this.deliveryFee(restaurant, branchId, input, zone) : 0;
    // A wallet card belongs to the signed-in customer and only a restaurant that takes the wallet sees it (docs/CUZDAN.md).
    const savedPaymentMethodId = input.payment?.savedPaymentMethodId;
    if (savedPaymentMethodId) {
      await this.wallets.assertUsable(restaurant.id, context.viewer?.id ?? null, savedPaymentMethodId);
    }

    const create: CreateOrderInput = {
      branchId,
      channel: context.channel,
      fulfillment: input.fulfillment,
      tableId: context.tableId,
      customer: input.customer,
      items: input.items,
      address: input.address,
      deliveryFeeMinor,
      payment: input.payment ? { ...input.payment, savedPaymentMethodId: undefined } : undefined,
      note: input.note,
      qrSessionId: context.sessionId ?? undefined,
      marketingOptIn: input.marketingOptIn,
      marketingChannels: input.marketingChannels,
      scheduledFor: input.scheduledFor,
      tab: input.tab,
    };
    // Points belong to the signed-in phone; an order placed for another number cannot spend them.
    let loyaltyUserId: string | undefined;
    if (input.useLoyaltyPoints) {
      if (!context.viewer) throw conflict('LOYALTY_SIGN_IN_REQUIRED', 'Sign in to use points');
      const phone = input.customer?.phone ?? input.address?.contactPhone ?? null;
      if (phone !== null && phone !== context.viewer.phone)
        throw conflict('LOYALTY_PHONE_MISMATCH', 'Points belong to the signed-in phone');
      // A dine-in order without a contact still has to belong to the person spending the points.
      if (phone === null) create.customer = { fullName: context.viewer.fullName, phone: context.viewer.phone };
      loyaltyUserId = context.viewer.id;
    }
    // Only the ordering page takes a channel link; it is kept while the module is on (docs/SIPARIS_BAGLANTILARI.md).
    const source =
      input.source &&
      context.channel === 'RESTAURANT_SITE' &&
      (await this.features.isEnabled('ordering_links', restaurant.id))
        ? input.source
        : undefined;
    const order = await this.orders.create(restaurant.id, create, null, false, {
      loyaltyUserId,
      couponCode: input.couponCode,
      source,
    });
    await this.attribution.identifyOrderSafely(order.id, context.visitorId);
    const loyaltyPointsRedeemed = loyaltyUserId ? await this.loyalty.redeemedPointsOf(order.id) : 0;
    const token = order.trackingUrl.split('/t/')[1] ?? '';
    let checkoutUrl: string | null = null;
    let status = order.status;
    if (order.status === 'PENDING_PAYMENT' && input.returnUrl) {
      if (savedPaymentMethodId) {
        checkoutUrl = await this.checkout.chargeSavedCard(order.id, savedPaymentMethodId, input.returnUrl);
        // A captured wallet charge has already placed the order.
        if (!checkoutUrl) {
          status = (await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } }))
            .status;
        }
      } else {
        const session = await this.checkout.startPublicCheckout(token, input.returnUrl);
        checkoutUrl = session.session.redirectUrl;
      }
    }
    return {
      trackingToken: token,
      trackingUrl: trackingUrl(this.config.getOrThrow<string>('PUBLIC_APP_URL'), token),
      shortCode: order.shortCode,
      status,
      fulfillment: order.fulfillment,
      chargedToCustomerMinor: order.chargedToCustomerMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      discountMinor: order.discountMinor,
      loyaltyPointsRedeemed,
      currency: order.currency,
      checkoutUrl,
      tabUrl: order.tabId ? this.tabs.tabUrl(await this.tabTokenOf(order.tabId)) : null,
    };
  }

  /**
   * Own courier: the restaurant's policy on a zero quote. Courier network: the
   * network's quote through the policy. A network cannot quote without
   * coordinates on both ends; the policy then applies on a zero quote, which
   * is the honest fee until the address is geocoded (docs/VITRIN.md).
   */
  private async deliveryFee(
    restaurant: RestaurantRow,
    branchId: string,
    input: PublicOrderInput,
    zone: DeliveryZone | null,
  ): Promise<number> {
    const basketMinor = await this.basketMinor(restaurant.id, input);
    const policy = DeliveryFeePolicySchema.safeParse(restaurant.deliveryFeePolicy);
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { addressLine: true, city: true, district: true, lat: true, lng: true, phone: true },
    });
    // Delivery zone (docs/VITRIN.md): radius and minimum first, then the own-courier fee by distance band.
    const distance = zone ? this.zones.distanceFrom(branch, input.address?.point) : null;
    if (zone) this.zones.assertDeliverable(zone, distance, basketMinor);
    const fallback =
      zone && restaurant.deliveryMode !== 'THIRD_PARTY_API'
        ? zoneDeliveryFee(zone, distance, basketMinor, policy.success ? policy.data : null)
        : policy.success
          ? customerDeliveryFee(0, basketMinor, policy.data)
          : 0;
    if (restaurant.deliveryMode !== 'THIRD_PARTY_API') return fallback;
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

  private async tabTokenOf(tabId: string): Promise<string> {
    const tab = await this.prisma.tableTab.findUniqueOrThrow({ where: { id: tabId }, select: { publicToken: true } });
    return tab.publicToken;
  }

  private async build(
    restaurant: RestaurantRow,
    table: { id: string; label: string } | null,
    branchId: string | null,
  ): Promise<StorefrontDTO> {
    const [categories, payment, loyalty, availability, zone, coupons, tracking, consentV2, scheduling, groupOrders] =
      await Promise.all([
        this.menu.menuOf(restaurant.id),
        this.mealCards.acceptedMethods(restaurant.id),
        this.loyalty.storefrontRules(restaurant.id),
        this.availability.of(restaurant, branchId),
        this.zones.activeZone(restaurant),
        this.coupons.accepts(restaurant.id),
        this.attribution.enabled(restaurant.id),
        this.features.isEnabled('consent_v2', restaurant.id),
        // A table orders for now; slots are for the restaurant's own ordering page.
        table ? Promise.resolve(null) : this.availability.scheduling(restaurant, branchId),
        // A shared basket lives on the restaurant's own page, not at a table (docs/GRUP_SIPARISI.md).
        table ? Promise.resolve(false) : this.features.isEnabled('group_orders', restaurant.id),
      ]);
    // The open tab is a table thing (docs/ACIK_HESAP.md).
    const tabsOn = table ? await this.features.isEnabled('table_tabs', restaurant.id) : false;
    const tab = table ? { enabled: tabsOn, open: tabsOn ? await this.tabs.openForTable(table.id) : null } : null;
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
      tab,
      payment,
      ordering: this.orderingOf(restaurant, table !== null, zone, coupons),
      categories,
      loyalty: loyalty
        ? {
            earnPoints: loyalty.earnPoints,
            earnStepMinor: loyalty.earnStepMinor,
            redeemPoints: loyalty.redeemPoints,
            redeemValueMinor: loyalty.redeemValueMinor,
            minOrderMinor: loyalty.minOrderMinor,
            maxDiscountBps: loyalty.maxDiscountBps,
          }
        : null,
      availability,
      tracking,
      consentV2,
      scheduling,
      groupOrders,
    };
  }

  private orderingOf(
    restaurant: RestaurantRow,
    hasTable: boolean,
    zone: DeliveryZone | null,
    coupons: boolean,
  ): StorefrontOrderingDTO {
    const policy = DeliveryFeePolicySchema.safeParse(restaurant.deliveryFeePolicy);
    return {
      dineIn: hasTable,
      pickup: true,
      delivery: restaurant.deliveryMode !== 'NONE' && restaurant.branches.length > 0,
      deliveryFeePolicy: policy.success ? policy.data : null,
      quotedDelivery: restaurant.deliveryMode === 'THIRD_PARTY_API',
      defaultPrepMinutes: dispatchSettingsFrom(restaurant.dispatchSettings).defaultPrepMinutes,
      deliveryZone: zone,
      coupons,
    };
  }
}

interface RestaurantRow {
  id: string;
  isPlatform: boolean;
  timezone: string;
  ordersPausedUntil: Date | null;
  busyExtraMinutes: number;
  busyUntil: Date | null;
  slug: string;
  name: string;
  currency: string;
  countryCode: string;
  logoUrl: string | null;
  themePrimary: string;
  defaultLocale: string;
  isActive: boolean;
  deliveryMode: 'RESTAURANT_COURIER' | 'THIRD_PARTY_API' | 'NONE';
  deliveryFeePolicy: unknown;
  deliveryZone: unknown;
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
