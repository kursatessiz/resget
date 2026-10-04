import { Injectable } from '@nestjs/common';
import { CAMPAIGN_ATTRIBUTION_DAYS } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../features/feature-flags.service';

const DAY_MS = 86_400_000;

/**
 * Campaign conversions (docs/KAMPANYALAR.md "Dönüşüm"): when a customer
 * places an order, the most recent campaign message they received within
 * that campaign's window is credited with it, last message wins. A message
 * is credited at most once (its first order) and an order to at most one
 * message. Revenue is the order's items gross at placement; cancelled
 * orders are left out when results are read.
 */
@Injectable()
export class CampaignAttributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
  ) {}

  async recordOrder(
    restaurantId: string,
    customerId: string,
    orderId: string,
    itemsGrossMinor: number,
    placedAt: Date,
  ): Promise<string | null> {
    if (!(await this.features.isEnabled('campaigns_v2', restaurantId))) return null;
    const candidates = await this.prisma.campaignRecipient.findMany({
      where: {
        customerId,
        status: 'SENT',
        convertedOrderId: null,
        sentAt: { gte: new Date(placedAt.getTime() - CAMPAIGN_ATTRIBUTION_DAYS.max * DAY_MS), lte: placedAt },
        campaign: { restaurantId },
      },
      orderBy: { sentAt: 'desc' },
      take: 20,
      select: { id: true, sentAt: true, campaign: { select: { attributionDays: true } } },
    });
    const hit = candidates.find(
      (c) => c.sentAt !== null && c.sentAt.getTime() >= placedAt.getTime() - c.campaign.attributionDays * DAY_MS,
    );
    if (!hit) return null;
    const credited = await this.prisma.campaignRecipient.updateMany({
      where: { id: hit.id, convertedOrderId: null },
      data: { convertedOrderId: orderId, convertedAt: placedAt, revenueMinor: itemsGrossMinor },
    });
    return credited.count > 0 ? hit.id : null;
  }
}
