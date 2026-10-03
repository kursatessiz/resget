import { Injectable, Logger } from '@nestjs/common';
import { DeliveryFeePolicySchema, customerDeliveryFee, orderShortCode } from '@resget/shared';
import type { CourierOverviewDTO, CourierQuote, CourierQuoteRequest } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CourierRegistry } from './courier.registry';
import { forbidden, notFound } from '../../common/api-error';

export interface QuoteWithCustomerFee {
  quote: CourierQuote;
  /** What the customer will be charged under the restaurant's delivery fee policy. */
  customerFeeMinor: number;
  /** Positive when the restaurant subsidises the courier, negative when it earns on the fee. */
  restaurantSubsidyMinor: number;
}

@Injectable()
export class CourierService {
  private readonly logger = new Logger(CourierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CourierRegistry,
  ) {}

  async quoteFor(
    restaurantId: string,
    request: Omit<CourierQuoteRequest, 'restaurantId'>,
    basketMinor: number,
  ): Promise<QuoteWithCustomerFee> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        deliveryMode: true,
        deliveryFeePolicy: true,
        courierProvider: { select: { code: true, isActive: true } },
      },
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    if (restaurant.deliveryMode !== 'THIRD_PARTY_API' || !restaurant.courierProvider?.isActive) {
      throw forbidden('COURIER_QUOTE_FAILED', 'Restaurant has no active courier network');
    }
    const adapter = this.registry.get(restaurant.courierProvider.code);
    if (!adapter) throw forbidden('COURIER_QUOTE_FAILED', `No adapter for ${restaurant.courierProvider.code}`);

    let quote: CourierQuote;
    try {
      quote = await adapter.quote({ ...request, restaurantId });
    } catch (err) {
      this.logger.warn(`Courier quote failed (${adapter.code}): ${(err as Error).message}`);
      throw forbidden('COURIER_QUOTE_FAILED', 'Courier network did not return a quote');
    }

    const policy = DeliveryFeePolicySchema.safeParse(restaurant.deliveryFeePolicy);
    const customerFeeMinor = customerDeliveryFee(
      quote.feeMinor,
      basketMinor,
      policy.success ? policy.data : { mode: 'PASS_THROUGH' },
    );
    return { quote, customerFeeMinor, restaurantSubsidyMinor: quote.feeMinor - customerFeeMinor };
  }
}

// -- The courier screen (docs/PANEL.md) ------------------------------------------------------

@Injectable()
export class CourierOverviewQueries {
  constructor(private readonly prisma: PrismaService) {}

  async overview(restaurantId: string): Promise<CourierOverviewDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        countryCode: true,
        currency: true,
        deliveryMode: true,
        deliveryFeePolicy: true,
        courierProviderId: true,
      },
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const [providers, couriers, requests, trips, delivered, failed] = await Promise.all([
      this.prisma.courierProvider.findMany({
        where: { OR: [{ countryCode: restaurant.countryCode }, { id: restaurant.courierProviderId ?? '' }] },
        select: { id: true, code: true, name: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.membership.findMany({
        where: {
          restaurantId,
          status: 'ACTIVE',
          roleTemplate: { OR: [{ isOwner: true }, { permissions: { some: { permissionKey: 'courier.deliver' } } }] },
        },
        select: {
          id: true,
          user: { select: { id: true, fullName: true, phone: true } },
          courierTrips: { where: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] } }, select: { id: true }, take: 1 },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.deliveryRequest.findMany({
        where: { restaurantId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          orderId: true,
          status: true,
          quoteFeeMinor: true,
          finalFeeMinor: true,
          currency: true,
          providerRef: true,
          trackingUrl: true,
          pickupEtaMinutes: true,
          dropoffEtaMinutes: true,
          failureReason: true,
          createdAt: true,
          provider: { select: { name: true } },
        },
      }),
      this.prisma.deliveryTrip.count({ where: { restaurantId, createdAt: { gte: dayStart } } }),
      this.prisma.deliveryStop.count({ where: { restaurantId, status: 'DELIVERED', updatedAt: { gte: dayStart } } }),
      this.prisma.deliveryStop.count({ where: { restaurantId, status: 'FAILED', updatedAt: { gte: dayStart } } }),
    ]);
    const policy = DeliveryFeePolicySchema.safeParse(restaurant.deliveryFeePolicy);
    return {
      deliveryMode: restaurant.deliveryMode,
      deliveryFeePolicy: policy.success ? policy.data : null,
      currency: restaurant.currency,
      providers,
      selectedProviderId: restaurant.courierProviderId,
      couriers: couriers.map((m) => ({
        membershipId: m.id,
        userId: m.user.id,
        fullName: m.user.fullName,
        phone: m.user.phone,
        // Live positions belong to the dispatch board; this screen lists who is on a trip.
        position: null,
        activeTripId: m.courierTrips[0]?.id ?? null,
      })),
      requests: requests.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        orderShortCode: orderShortCode(r.orderId),
        status: r.status,
        quoteFeeMinor: r.quoteFeeMinor,
        finalFeeMinor: r.finalFeeMinor,
        currency: r.currency,
        providerName: r.provider.name,
        providerRef: r.providerRef,
        trackingUrl: r.trackingUrl,
        pickupEtaMinutes: r.pickupEtaMinutes,
        dropoffEtaMinutes: r.dropoffEtaMinutes,
        failureReason: r.failureReason,
        createdAt: r.createdAt.toISOString(),
      })),
      today: { trips, delivered, failed },
    };
  }

  /** Which network quotes this restaurant's deliveries; only an active network of its country. */
  async selectProvider(restaurantId: string, courierProviderId: string | null): Promise<CourierOverviewDTO> {
    if (courierProviderId) {
      const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
        select: { countryCode: true },
      });
      const provider = await this.prisma.courierProvider.findFirst({
        where: { id: courierProviderId, isActive: true, countryCode: restaurant.countryCode },
        select: { id: true },
      });
      if (!provider) throw notFound('COURIER_PROVIDER_NOT_FOUND', 'Courier network not found');
    }
    await this.prisma.restaurant.update({ where: { id: restaurantId }, data: { courierProviderId } });
    return this.overview(restaurantId);
  }
}
