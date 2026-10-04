import { Injectable } from '@nestjs/common';
import { CAMPAIGN_ATTRIBUTION_DAYS } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../features/feature-flags.service';

const DAY_MS = 86_400_000;

/**
 * Conversions (docs/KAMPANYALAR.md "Dönüşüm", docs/AKISLAR.md): when a
 * customer places an order, the most recent campaign or flow message they
 * received within its own window is credited with it, last message wins. A message
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
    const [campaignsOn, journeysOn] = await Promise.all([
      this.features.isEnabled('campaigns_v2', restaurantId),
      this.features.isEnabled('journeys', restaurantId),
    ]);
    if (!campaignsOn && !journeysOn) return null;
    const since = new Date(placedAt.getTime() - CAMPAIGN_ATTRIBUTION_DAYS.max * DAY_MS);
    const window = { gte: since, lte: placedAt };
    const [campaignMessages, flowMessages] = await Promise.all([
      campaignsOn
        ? this.prisma.campaignRecipient.findMany({
            where: { customerId, status: 'SENT', convertedOrderId: null, sentAt: window, campaign: { restaurantId } },
            orderBy: { sentAt: 'desc' },
            take: 20,
            select: { id: true, sentAt: true, campaign: { select: { attributionDays: true } } },
          })
        : [],
      journeysOn
        ? this.prisma.journeyRun.findMany({
            where: { customerId, status: 'SENT', convertedOrderId: null, sentAt: window, journey: { restaurantId } },
            orderBy: { sentAt: 'desc' },
            take: 20,
            select: { id: true, sentAt: true, journey: { select: { attributionDays: true } } },
          })
        : [],
    ]);
    // Campaign messages and flow messages compete: the latest one inside its own window wins.
    const candidates = [
      ...campaignMessages.map((m) => ({
        kind: 'campaign' as const,
        id: m.id,
        sentAt: m.sentAt,
        days: m.campaign.attributionDays,
      })),
      ...flowMessages.map((m) => ({
        kind: 'journey' as const,
        id: m.id,
        sentAt: m.sentAt,
        days: m.journey.attributionDays,
      })),
    ]
      .filter((c): c is typeof c & { sentAt: Date } => c.sentAt !== null)
      .filter((c) => c.sentAt.getTime() >= placedAt.getTime() - c.days * DAY_MS)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
    const hit = candidates[0];
    if (!hit) return null;
    const data = { convertedOrderId: orderId, convertedAt: placedAt, revenueMinor: itemsGrossMinor };
    const credited =
      hit.kind === 'campaign'
        ? await this.prisma.campaignRecipient.updateMany({ where: { id: hit.id, convertedOrderId: null }, data })
        : await this.prisma.journeyRun.updateMany({ where: { id: hit.id, convertedOrderId: null }, data });
    return credited.count > 0 ? hit.id : null;
  }
}
