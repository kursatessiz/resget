import { Injectable } from '@nestjs/common';
import { computeModeSettlement, settlementDefaultsFor } from '@resget/shared';
import type { ModeSettlement, SettlementLine } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../../common/api-error';

export interface SettlementPreviewInput {
  items: SettlementLine[];
  deliveryFee?: SettlementLine | null;
  discount?: { amountMinor: number; fundedBy: 'RESTAURANT' | 'PLATFORM' } | null;
  courier?: { costMinor: number; bearer: 'RESTAURANT' | 'PLATFORM' } | null;
}

/** Binds the pure settlement engine to a restaurant's contract (payment mode, commission, PSP rate, region). */
@Injectable()
export class SettlementService {
  constructor(private readonly prisma: PrismaService) {}

  async forRestaurant(restaurantId: string, input: SettlementPreviewInput): Promise<ModeSettlement> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        currency: true,
        countryCode: true,
        commissionBps: true,
        pspPercentBps: true,
        pspFixedMinor: true,
        paymentMode: true,
      },
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    const regional = settlementDefaultsFor(restaurant.countryCode);
    return computeModeSettlement(restaurant.paymentMode, {
      currency: restaurant.currency,
      items: input.items,
      deliveryFee: input.deliveryFee ?? null,
      discount: input.discount ?? null,
      commissionBps: restaurant.commissionBps,
      commissionVatBps: regional.commissionVatBps,
      psp: { percentBps: restaurant.pspPercentBps, fixedMinor: restaurant.pspFixedMinor, bearer: 'RESTAURANT' },
      withholdingBps: regional.withholdingBps,
      courier: input.courier ?? null,
    });
  }
}
