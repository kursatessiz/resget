import { Injectable, Logger } from '@nestjs/common';
import { DeliveryFeePolicySchema, customerDeliveryFee } from '@resget/shared';
import type { CourierQuote, CourierQuoteRequest } from '@resget/shared';
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
