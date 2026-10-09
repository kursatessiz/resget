import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extractEmailLinks } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../features/feature-flags.service';

/**
 * Opens and clicks of campaign emails (docs/EPOSTA.md, "Açılma ve tıklama ölçümü"). Only times and counts on
 * the recipient row are written; nothing about the device or the network. A click's destination is always read
 * from the text the recipient was sent, never from the request.
 */
@Injectable()
export class EmailTrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly config: ConfigService,
  ) {}

  /** Records an open of a known, tracked recipient; an unknown token changes nothing. */
  async recordOpen(token: string, now: Date = new Date()): Promise<void> {
    const recipient = await this.tracked(token);
    if (!recipient?.record) return;
    await this.markOpened(recipient.id, now);
  }

  /** Where an unknown link leads: the platform's home page. */
  home(): string {
    return this.config.getOrThrow<string>('PUBLIC_APP_URL');
  }

  /** Where a tracked link goes: the recipient's own campaign text decides; anything unknown goes home. */
  async resolveClick(token: string, index: number, now: Date = new Date()): Promise<string> {
    const home = this.home();
    const recipient = await this.tracked(token);
    if (!recipient) return home;
    const body =
      recipient.variant === 'B' && recipient.campaign.variantBody
        ? recipient.campaign.variantBody
        : recipient.campaign.body;
    const destination = extractEmailLinks(body)[index];
    if (!destination) return home;
    if (recipient.record) {
      await this.markOpened(recipient.id, now);
      await this.prisma.campaignRecipient.updateMany({
        where: { id: recipient.id, clickedAt: null },
        data: { clickedAt: now },
      });
      await this.prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { clickCount: { increment: 1 } },
      });
    }
    return destination;
  }

  private async tracked(token: string) {
    const recipient = await this.prisma.campaignRecipient.findUnique({
      where: { trackingToken: token },
      select: {
        id: true,
        variant: true,
        campaign: { select: { restaurantId: true, channel: true, body: true, variantBody: true } },
      },
    });
    if (!recipient || recipient.campaign.channel !== 'EMAIL') return null;
    // Switched off later: links still lead on, nothing more is recorded.
    const record = await this.features.isEnabled('email_tracking', recipient.campaign.restaurantId);
    return { ...recipient, record };
  }

  private async markOpened(recipientId: string, now: Date): Promise<void> {
    await this.prisma.campaignRecipient.updateMany({
      where: { id: recipientId, openedAt: null },
      data: { openedAt: now },
    });
    await this.prisma.campaignRecipient.update({ where: { id: recipientId }, data: { openCount: { increment: 1 } } });
  }
}
