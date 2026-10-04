import { Injectable, Logger } from '@nestjs/common';
import { CampaignStatus, Prisma } from '@resget/database';
import {
  BASE_LOCALE,
  BUNDLED_MESSAGES,
  CAMPAIGN_BATCH_SIZE,
  CAMPAIGN_BEST_HOUR_LOOKBACK_DAYS,
  CONVERSION_EXCLUDED_ORDER_STATUSES,
  CampaignSegmentSchema,
  abVariantFor,
  bestHourDueAt,
  campaignContentIssue,
  preferredHourOf,
  usesCampaignsV2,
  createTranslator,
  isWithinSendWindow,
  nextSendWindowStart,
  CONSENT_CHANNELS,
} from '@resget/shared';
import type {
  CampaignAudienceDTO,
  CampaignChannel,
  CampaignDTO,
  CampaignResultsDTO,
  CampaignVariant,
  CampaignDetailDTO,
  CampaignPageDTO,
  CampaignPreviewDTO,
  CampaignSegment,
  CreateCampaignInput,
  SendCampaignInput,
  UpdateCampaignInput,
  SavedSegmentDTO,
  SaveSegmentInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { badRequest, conflict, forbidden, notFound } from '../../common/api-error';
import { ConsentService } from '../consent/consent.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { SegmentsService } from '../segments/segments.service';
import { CommercialSenderService } from './commercial-sender.service';

type SegmentRow = Prisma.CampaignSegmentPresetGetPayload<Record<string, never>>;

const campaignSelect = Prisma.validator<Prisma.CampaignSelect>()({
  id: true,
  restaurantId: true,
  name: true,
  channel: true,
  body: true,
  status: true,
  segment: true,
  segmentId: true,
  subject: true,
  variantBody: true,
  variantSubject: true,
  variantSharePct: true,
  sendTimeMode: true,
  attributionDays: true,
  scheduledAt: true,
  startedAt: true,
  finishedAt: true,
  audienceCount: true,
  sentCount: true,
  failedCount: true,
  skippedCount: true,
  lastError: true,
  createdAt: true,
});
type CampaignRow = Prisma.CampaignGetPayload<{ select: typeof campaignSelect }>;

const DAY_MS = 86_400_000;
/** Contacts with an address to mail: their own on the contact card or the one on their account. */
const HAS_EMAIL: Prisma.RestaurantCustomerWhereInput = {
  OR: [{ email: { not: null } }, { user: { email: { not: null } } }],
};

/**
 * Campaigns (docs/KAMPANYALAR.md): drafts, audience preview, scheduling and
 * the batch runner. Recipients are materialised when the campaign starts,
 * so a customer who opts out between two batches is skipped, never sent.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly features: FeatureFlagsService,
    private readonly savedSegments: SegmentsService,
    private readonly sender: CommercialSenderService,
  ) {}

  /** Email, A/B, best hour and attribution belong to campaigns_v2; email also needs the email module. */
  private async checkV2(restaurantId: string, input: Parameters<typeof usesCampaignsV2>[0]): Promise<void> {
    if (!usesCampaignsV2(input)) return;
    await this.features.assertEnabled('campaigns_v2', restaurantId);
    if (input.channel === 'EMAIL') await this.features.assertEnabled('email_channel', restaurantId);
  }

  /** A saved segment for a campaign must be the tenant's own and the module must be on. */
  private async checkSegment(restaurantId: string, segmentId: string | null | undefined): Promise<void> {
    if (!segmentId) return;
    await this.features.assertEnabled('segments_v2', restaurantId);
    await this.savedSegments.require(restaurantId, segmentId);
  }

  /** The campaign's audience on its channel: the saved segment when chosen, otherwise the inline filters. */
  private async campaignAudienceWhere(
    restaurantId: string,
    row: { segment: Prisma.JsonValue; segmentId: string | null },
    now: Date,
    channel: CampaignChannel,
  ): Promise<Prisma.RestaurantCustomerWhereInput> {
    const base = await this.baseAudienceWhere(restaurantId, row, now, channel);
    return channel === 'EMAIL' ? { AND: [base, HAS_EMAIL] } : base;
  }

  private async baseAudienceWhere(
    restaurantId: string,
    row: { segment: Prisma.JsonValue; segmentId: string | null },
    now: Date,
    channel: CampaignChannel,
  ): Promise<Prisma.RestaurantCustomerWhereInput> {
    if (row.segmentId) {
      const segment = await this.prisma.segment.findFirst({ where: { id: row.segmentId, restaurantId } });
      // A segment that has gone reaches no one; it never falls back to the inline filters.
      if (!segment) return { restaurantId, id: { in: [] } };
      return { AND: [this.savedSegments.audienceWhere(segment, now), { consentChannels: { has: channel } }] };
    }
    const parsed = CampaignSegmentSchema.safeParse(row.segment ?? {});
    return this.audienceWhere(restaurantId, parsed.success ? parsed.data : {}, now, channel);
  }

  // -- Drafts --------------------------------------------------------------------------------

  async list(restaurantId: string, page: number, pageSize: number, status?: string): Promise<CampaignPageDTO> {
    const where: Prisma.CampaignWhereInput = {
      restaurantId,
      ...(status && status in CampaignStatus ? { status: status as CampaignStatus } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: campaignSelect,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return { items: rows.map((r) => this.toDto(r)), total, page, pageSize };
  }

  async audience(restaurantId: string): Promise<CampaignAudienceDTO> {
    const [total, optedIn] = await Promise.all([
      this.prisma.restaurantCustomer.count({ where: { restaurantId } }),
      this.prisma.restaurantCustomer.count({ where: { restaurantId, marketingOptIn: true } }),
    ]);
    return { total, optedIn };
  }

  // -- Saved segments ---------------------------------------------------------------------

  async countAudience(restaurantId: string, segment: CampaignSegment, now: Date = new Date()): Promise<number> {
    return this.prisma.restaurantCustomer.count({ where: this.audienceWhere(restaurantId, segment, now) });
  }

  async segments(restaurantId: string): Promise<SavedSegmentDTO[]> {
    const rows = await this.prisma.campaignSegmentPreset.findMany({
      where: { restaurantId },
      orderBy: { name: 'asc' },
    });
    const now = new Date();
    return Promise.all(rows.map((row) => this.toSegmentDto(row, now)));
  }

  async saveSegment(restaurantId: string, input: SaveSegmentInput, segmentId?: string): Promise<SavedSegmentDTO> {
    const clash = await this.prisma.campaignSegmentPreset.findUnique({
      where: { restaurantId_name: { restaurantId, name: input.name } },
      select: { id: true },
    });
    if (clash && clash.id !== segmentId) throw conflict('SEGMENT_NAME_TAKEN', 'Segment name already used');
    const data = { name: input.name, segment: input.segment as Prisma.InputJsonObject };
    let row: SegmentRow;
    if (segmentId) {
      const existing = await this.prisma.campaignSegmentPreset.findFirst({ where: { id: segmentId, restaurantId } });
      if (!existing) throw notFound('SEGMENT_NOT_FOUND', 'Segment not found');
      row = await this.prisma.campaignSegmentPreset.update({ where: { id: segmentId }, data });
    } else {
      row = await this.prisma.campaignSegmentPreset.create({ data: { restaurantId, ...data } });
    }
    return this.toSegmentDto(row, new Date());
  }

  async deleteSegment(restaurantId: string, segmentId: string): Promise<void> {
    const removed = await this.prisma.campaignSegmentPreset.deleteMany({ where: { id: segmentId, restaurantId } });
    if (removed.count === 0) throw notFound('SEGMENT_NOT_FOUND', 'Segment not found');
  }

  private async toSegmentDto(row: SegmentRow, now: Date): Promise<SavedSegmentDTO> {
    const parsed = CampaignSegmentSchema.safeParse(row.segment ?? {});
    const segment = parsed.success ? parsed.data : {};
    return {
      id: row.id,
      name: row.name,
      segment,
      audienceCount: await this.countAudience(row.restaurantId, segment, now),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // -- Campaigns ----------------------------------------------------------------------------

  async create(restaurantId: string, userId: string, input: CreateCampaignInput): Promise<CampaignDTO> {
    await this.checkSegment(restaurantId, input.segmentId);
    await this.checkV2(restaurantId, input);
    const row = await this.prisma.campaign.create({
      data: {
        restaurantId,
        name: input.name,
        channel: input.channel,
        body: input.body,
        subject: input.subject ?? null,
        variantBody: input.variant?.body ?? null,
        variantSubject: input.variant?.subject ?? null,
        variantSharePct: input.variant?.sharePct ?? null,
        sendTimeMode: input.sendTimeMode,
        ...(input.attributionDays !== undefined ? { attributionDays: input.attributionDays } : {}),
        segment: input.segment,
        segmentId: input.segmentId ?? null,
        createdByUserId: userId,
        ...(input.scheduledAt ? { status: CampaignStatus.SCHEDULED, scheduledAt: new Date(input.scheduledAt) } : {}),
      },
      select: campaignSelect,
    });
    return this.toDto(row);
  }

  async update(restaurantId: string, campaignId: string, input: UpdateCampaignInput): Promise<CampaignDTO> {
    const row = await this.requireCampaign(restaurantId, campaignId);
    if (row.status !== 'DRAFT' && row.status !== 'SCHEDULED') {
      throw conflict('CAMPAIGN_STATE_INVALID', 'Only a draft or scheduled campaign can be edited');
    }
    await this.checkSegment(restaurantId, input.segmentId);
    await this.checkV2(restaurantId, input);
    const variant =
      input.variant === undefined
        ? row.variantBody
          ? { body: row.variantBody, subject: row.variantSubject }
          : null
        : input.variant;
    const issue = campaignContentIssue({
      channel: input.channel ?? (row.channel as CampaignChannel),
      body: input.body ?? row.body,
      subject: input.subject === undefined ? row.subject : input.subject,
      variant,
    });
    if (issue) throw badRequest('CAMPAIGN_CONTENT_INVALID', `Campaign content: ${issue}`);
    const updated = await this.prisma.campaign.update({
      where: { id: row.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.variant !== undefined
          ? {
              variantBody: input.variant?.body ?? null,
              variantSubject: input.variant?.subject ?? null,
              variantSharePct: input.variant?.sharePct ?? null,
            }
          : {}),
        ...(input.sendTimeMode !== undefined ? { sendTimeMode: input.sendTimeMode } : {}),
        ...(input.attributionDays !== undefined ? { attributionDays: input.attributionDays } : {}),
        ...(input.segment !== undefined ? { segment: input.segment } : {}),
        ...(input.segmentId !== undefined ? { segmentId: input.segmentId } : {}),
      },
      select: campaignSelect,
    });
    return this.toDto(updated);
  }

  async detail(restaurantId: string, campaignId: string): Promise<CampaignDetailDTO> {
    const row = await this.requireCampaign(restaurantId, campaignId);
    const recipients = await this.prisma.campaignRecipient.findMany({
      where: { campaignId: row.id },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: {
        id: true,
        customerId: true,
        status: true,
        errorCode: true,
        sentAt: true,
        variant: true,
        dueAt: true,
        convertedAt: true,
        customer: { select: { user: { select: { fullName: true } } } },
      },
    });
    return {
      ...this.toDto(row),
      recipients: recipients.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        fullName: r.customer.user.fullName,
        status: r.status,
        errorCode: r.errorCode,
        sentAt: r.sentAt?.toISOString() ?? null,
        variant: r.variant === 'B' ? 'B' : 'A',
        dueAt: r.dueAt?.toISOString() ?? null,
        convertedAt: r.convertedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Who would receive it now, what it costs, and whether it may go out at this hour. */
  async preview(restaurantId: string, campaignId: string, now: Date = new Date()): Promise<CampaignPreviewDTO> {
    const row = await this.requireCampaign(restaurantId, campaignId);
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { name: true, timezone: true, defaultLocale: true },
    });
    const channel = await this.sender.effectiveChannel(restaurantId, row.channel as CampaignChannel);
    const audienceCount = await this.prisma.restaurantCustomer.count({
      where: await this.campaignAudienceWhere(restaurantId, row, now, channel),
    });
    const wallet = await this.prisma.messageWallet.findUnique({
      where: { restaurantId_channel: { restaurantId, channel: row.channel } },
      select: { balance: true },
    });
    const balance = wallet?.balance ?? 0;
    // Email is never charged to a wallet (CLAUDE.md rule 9).
    const creditsNeeded = channel === 'EMAIL' ? 0 : audienceCount;
    return {
      audienceCount,
      creditsNeeded,
      walletBalance: balance,
      enoughCredits: balance >= creditsNeeded,
      renderedExample: this.example(row, 'A', restaurant.name, restaurant.defaultLocale),
      renderedVariantExample: row.variantBody
        ? this.example(row, 'B', restaurant.name, restaurant.defaultLocale)
        : null,
      withinSendWindowNow: isWithinSendWindow(now, restaurant.timezone),
      nextSendWindowStart: nextSendWindowStart(now, restaurant.timezone).toISOString(),
      timezone: restaurant.timezone,
    };
  }

  /** Queues the campaign: now or at the given moment. The runner respects the send window either way. */
  async send(restaurantId: string, campaignId: string, input: SendCampaignInput): Promise<CampaignDTO> {
    const row = await this.requireCampaign(restaurantId, campaignId);
    if (row.status !== 'DRAFT' && row.status !== 'SCHEDULED') {
      throw conflict('CAMPAIGN_STATE_INVALID', 'Campaign was already sent or cancelled');
    }
    if (row.channel === 'EMAIL') {
      const blocker = await this.sender.emailBlocker(restaurantId, ['campaigns_v2']);
      if (blocker === 'FEATURE_DISABLED') throw forbidden('FEATURE_DISABLED', 'Email campaigns are switched off');
      if (blocker) throw conflict(blocker, 'No verified sending domain');
    }
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
    const updated = await this.prisma.campaign.update({
      where: { id: row.id },
      data: { status: CampaignStatus.SCHEDULED, scheduledAt, lastError: null },
      select: campaignSelect,
    });
    return this.toDto(updated);
  }

  async cancel(restaurantId: string, campaignId: string): Promise<CampaignDTO> {
    const row = await this.requireCampaign(restaurantId, campaignId);
    if (row.status === 'SENT' || row.status === 'CANCELLED') {
      throw conflict('CAMPAIGN_STATE_INVALID', 'Campaign is already finished');
    }
    const updated = await this.prisma.campaign.update({
      where: { id: row.id },
      data: { status: CampaignStatus.CANCELLED, finishedAt: new Date() },
      select: campaignSelect,
    });
    return this.toDto(updated);
  }

  // -- Opt-out ---------------------------------------------------------------------------------

  /** One click from a campaign message: the customer stops receiving commercial messages of that restaurant. */
  async optOut(token: string): Promise<{ restaurantName: string }> {
    const customer = await this.prisma.restaurantCustomer.findUnique({
      where: { marketingToken: token },
      select: { id: true, restaurant: { select: { name: true } } },
    });
    if (!customer) throw notFound('NOT_FOUND', 'Unknown opt-out link');
    // The link refuses every channel, including those the customer never chose (docs/RIZA.md).
    await this.consent.revoke(customer.id, CONSENT_CHANNELS, 'OPT_OUT_LINK');
    return { restaurantName: customer.restaurant.name };
  }

  // -- Runner ----------------------------------------------------------------------------------

  /**
   * One pass: due SCHEDULED campaigns start (recipients materialised), then
   * every SENDING campaign inside its send window sends one batch. Returns
   * how many messages were sent in this pass.
   */
  async runPass(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.SCHEDULED, scheduledAt: { lte: now } },
      select: {
        id: true,
        restaurantId: true,
        segment: true,
        segmentId: true,
        channel: true,
        variantSharePct: true,
        sendTimeMode: true,
        restaurant: { select: { timezone: true } },
      },
      take: 20,
    });
    for (const campaign of due) await this.start(campaign, now);

    const sending = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.SENDING },
      select: {
        ...campaignSelect,
        restaurant: { select: { name: true, countryCode: true, timezone: true, defaultLocale: true } },
      },
      take: 20,
    });
    let sent = 0;
    for (const campaign of sending) {
      if (!isWithinSendWindow(now, campaign.restaurant.timezone)) continue;
      sent += await this.sendBatch(campaign, now);
    }
    return sent;
  }

  private async start(
    campaign: {
      id: string;
      restaurantId: string;
      segment: Prisma.JsonValue;
      segmentId: string | null;
      channel: string;
      variantSharePct: number | null;
      sendTimeMode: string;
      restaurant: { timezone: string };
    },
    now: Date,
  ): Promise<void> {
    const started = await this.prisma.campaign.updateMany({
      where: { id: campaign.id, status: CampaignStatus.SCHEDULED },
      data: { status: CampaignStatus.SENDING, startedAt: now },
    });
    if (started.count === 0) return;
    const channel = await this.sender.effectiveChannel(campaign.restaurantId, campaign.channel as CampaignChannel);
    const audience = await this.prisma.restaurantCustomer.findMany({
      where: await this.campaignAudienceWhere(campaign.restaurantId, campaign, now, channel),
      select: { id: true },
    });
    if (audience.length > 0) {
      const due =
        campaign.sendTimeMode === 'BEST_HOUR'
          ? await this.bestHourDue(
              campaign.restaurantId,
              campaign.restaurant.timezone,
              audience.map((c) => c.id),
              now,
            )
          : new Map<string, Date>();
      await this.prisma.campaignRecipient.createMany({
        data: audience.map((c) => ({
          campaignId: campaign.id,
          customerId: c.id,
          variant: abVariantFor(campaign.id, c.id, campaign.variantSharePct),
          dueAt: due.get(c.id) ?? null,
        })),
        skipDuplicates: true,
      });
    }
    await this.prisma.campaign.update({ where: { id: campaign.id }, data: { audienceCount: audience.length } });
    if (audience.length === 0) await this.finish(campaign.id, now);
  }

  private async sendBatch(
    campaign: CampaignRow & {
      restaurant: { name: string; countryCode: string; timezone: string; defaultLocale: string };
    },
    now: Date,
  ): Promise<number> {
    // BEST_HOUR recipients wait for their hour; the others are due at once.
    const pending = await this.prisma.campaignRecipient.findMany({
      where: { campaignId: campaign.id, status: 'PENDING', OR: [{ dueAt: null }, { dueAt: { lte: now } }] },
      orderBy: { createdAt: 'asc' },
      take: CAMPAIGN_BATCH_SIZE,
      select: {
        id: true,
        variant: true,
        customer: {
          select: {
            id: true,
            marketingToken: true,
            email: true,
            user: { select: { phone: true, locale: true, email: true } },
          },
        },
      },
    });
    if (pending.length === 0) {
      await this.finish(campaign.id, now);
      return 0;
    }
    const channel = await this.sender.effectiveChannel(campaign.restaurantId, campaign.channel as CampaignChannel);
    // An email campaign pauses (and resumes by itself) while its modules are off or no domain is verified.
    if (channel === 'EMAIL') {
      const blocker = await this.sender.emailBlocker(campaign.restaurantId, ['campaigns_v2']);
      if (blocker) {
        await this.prisma.campaign.update({ where: { id: campaign.id }, data: { lastError: blocker } });
        return 0;
      }
    }
    const recipients = pending.map((r) => ({
      id: r.id,
      variant: r.variant,
      contact: {
        customerId: r.customer.id,
        phone: r.customer.user.phone,
        email: r.customer.email ?? r.customer.user.email ?? null,
        locale: r.customer.user.locale,
        marketingToken: r.customer.marketingToken,
      },
    }));
    // Fresh consent, caps, registry and an address on the channel, per recipient (docs/RIZA.md).
    const checks = await this.sender.check(
      campaign.restaurantId,
      campaign.restaurant.countryCode,
      channel,
      recipients.map((r) => r.contact),
      now,
    );
    let sent = 0;
    for (const recipient of recipients) {
      const refusal = checks.get(recipient.contact.customerId) ?? null;
      if (refusal !== null) {
        await this.markRecipient(recipient.id, campaign.id, 'SKIPPED', refusal);
        continue;
      }
      const content = this.contentFor(campaign, recipient.variant === 'B' ? 'B' : 'A');
      const result = await this.sender.deliver({
        restaurantId: campaign.restaurantId,
        restaurantName: campaign.restaurant.name,
        defaultLocale: campaign.restaurant.defaultLocale,
        channel,
        recipient: recipient.contact,
        body: content.body,
        subject: content.subject,
      });
      if (result.status === 'SENT') {
        sent += 1;
        await this.markRecipient(recipient.id, campaign.id, 'SENT', null, result.logId ?? undefined, now);
        continue;
      }
      if (result.errorCode === 'INSUFFICIENT_CREDITS') {
        // Stop here; the campaign resumes at the next pass once credits are bought.
        await this.prisma.campaign.update({ where: { id: campaign.id }, data: { lastError: 'INSUFFICIENT_CREDITS' } });
        return sent;
      }
      await this.markRecipient(
        recipient.id,
        campaign.id,
        result.status === 'SKIPPED' ? 'SKIPPED' : 'FAILED',
        result.errorCode ?? 'FAILED',
        result.logId ?? undefined,
      );
    }
    if (pending.length < CAMPAIGN_BATCH_SIZE) await this.finish(campaign.id, now);
    return sent;
  }

  private async markRecipient(
    recipientId: string,
    campaignId: string,
    status: 'SENT' | 'FAILED' | 'SKIPPED',
    errorCode: string | null,
    messageLogId?: string,
    sentAt?: Date,
  ): Promise<void> {
    const counter = status === 'SENT' ? 'sentCount' : status === 'FAILED' ? 'failedCount' : 'skippedCount';
    await this.prisma.$transaction([
      this.prisma.campaignRecipient.update({
        where: { id: recipientId },
        data: { status, errorCode, messageLogId: messageLogId ?? null, sentAt: sentAt ?? null },
      }),
      this.prisma.campaign.update({
        where: { id: campaignId },
        data: { [counter]: { increment: 1 }, lastError: null },
      }),
    ]);
  }

  private async finish(campaignId: string, now: Date): Promise<void> {
    const remaining = await this.prisma.campaignRecipient.count({ where: { campaignId, status: 'PENDING' } });
    if (remaining > 0) return;
    await this.prisma.campaign.updateMany({
      where: { id: campaignId, status: CampaignStatus.SENDING },
      data: { status: CampaignStatus.SENT, finishedAt: now },
    });
  }

  // -- Internals -------------------------------------------------------------------------------

  /** Opted-in customers of the restaurant narrowed by the segment; a missing phone can never happen (users are phones). */
  private audienceWhere(
    restaurantId: string,
    segment: CampaignSegment,
    now: Date,
    channel?: CampaignChannel,
  ): Prisma.RestaurantCustomerWhereInput {
    // With a channel: those reachable on it now (docs/RIZA.md); without one (saved segments): reachable on any.
    const where: Prisma.RestaurantCustomerWhereInput = channel
      ? { restaurantId, consentChannels: { has: channel } }
      : { restaurantId, marketingOptIn: true };
    if (segment.minOrders !== undefined) where.orderCount = { gte: segment.minOrders };
    if (segment.lastOrderWithinDays !== undefined) {
      where.lastOrderAt = { gte: new Date(now.getTime() - segment.lastOrderWithinDays * DAY_MS) };
    }
    if (segment.inactiveForDays !== undefined) {
      const before = new Date(now.getTime() - segment.inactiveForDays * DAY_MS);
      where.OR = [{ lastOrderAt: null }, { lastOrderAt: { lt: before } }];
    }
    if (segment.tags && segment.tags.length > 0) where.tags = { hasSome: segment.tags };
    if (segment.firstChannel) where.firstChannel = segment.firstChannel;
    return where;
  }

  private segmentOf(row: CampaignRow): CampaignSegment {
    const parsed = CampaignSegmentSchema.safeParse(row.segment ?? {});
    return parsed.success ? parsed.data : {};
  }

  private contentFor(row: CampaignRow, variant: CampaignVariant): { body: string; subject: string | null } {
    if (variant === 'B' && row.variantBody)
      return { body: row.variantBody, subject: row.variantSubject ?? row.subject };
    return { body: row.body, subject: row.subject };
  }

  private example(row: CampaignRow, variant: CampaignVariant, restaurant: string, locale: string): string {
    const content = this.contentFor(row, variant);
    if (row.channel === 'EMAIL') return `${content.subject ?? ''}\n\n${content.body}`;
    return this.render(content.body, restaurant, this.sender.optOutUrl('ornek'), locale);
  }

  /**
   * BEST_HOUR: each recipient's most frequent local ordering hour over the
   * lookback, turned into the next due moment inside the send window.
   * Recipients without history are due at once.
   */
  private async bestHourDue(
    restaurantId: string,
    timezone: string,
    customerIds: string[],
    now: Date,
  ): Promise<Map<string, Date>> {
    const since = new Date(now.getTime() - CAMPAIGN_BEST_HOUR_LOOKBACK_DAYS * DAY_MS);
    const rows = await this.prisma.$queryRaw<{ customerId: string; hour: number; count: number }[]>`
      SELECT rc.id AS "customerId",
             EXTRACT(HOUR FROM ((o."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}))::int AS hour,
             COUNT(*)::int AS count
      FROM orders o
      JOIN restaurant_customers rc ON rc."userId" = o."customerUserId" AND rc."restaurantId" = o."restaurantId"
      WHERE o."restaurantId" = ${restaurantId}
        AND o."placedAt" >= ${since}
        AND rc.id = ANY(${customerIds})
      GROUP BY 1, 2`;
    const byCustomer = new Map<string, { hour: number; count: number }[]>();
    for (const row of rows) byCustomer.set(row.customerId, [...(byCustomer.get(row.customerId) ?? []), row]);
    const due = new Map<string, Date>();
    for (const [customerId, counts] of byCustomer) {
      const hour = preferredHourOf(counts);
      if (hour !== null) due.set(customerId, bestHourDueAt(now, timezone, hour));
    }
    return due;
  }

  /** Per variant: delivery counts, credited first orders and their revenue (docs/KAMPANYALAR.md "Dönüşüm"). */
  async results(restaurantId: string, campaignId: string): Promise<CampaignResultsDTO> {
    await this.features.assertEnabled('campaigns_v2', restaurantId);
    const row = await this.requireCampaign(restaurantId, campaignId);
    const [restaurant, grouped, converted] = await Promise.all([
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { currency: true } }),
      this.prisma.campaignRecipient.groupBy({
        by: ['variant', 'status'],
        where: { campaignId: row.id },
        _count: { _all: true },
      }),
      this.prisma.campaignRecipient.findMany({
        where: {
          campaignId: row.id,
          convertedOrderId: { not: null },
          convertedOrder: { status: { notIn: [...CONVERSION_EXCLUDED_ORDER_STATUSES] } },
        },
        select: { variant: true, revenueMinor: true },
      }),
    ]);
    const variants: CampaignVariant[] = row.variantSharePct ? ['A', 'B'] : ['A'];
    const results = variants.map((variant) => {
      const count = (status: string) =>
        grouped.filter((g) => g.variant === variant && g.status === status).reduce((n, g) => n + g._count._all, 0);
      const mine = converted.filter((c) => c.variant === variant);
      const sent = count('SENT');
      return {
        variant,
        recipients: grouped.filter((g) => g.variant === variant).reduce((n, g) => n + g._count._all, 0),
        sent,
        failed: count('FAILED'),
        skipped: count('SKIPPED'),
        conversions: mine.length,
        revenueMinor: mine.reduce((n, c) => n + (c.revenueMinor ?? 0), 0),
        conversionRateBps: sent > 0 ? Math.round((mine.length * 10_000) / sent) : 0,
      };
    });
    let leader: CampaignVariant | null = null;
    const [a, b] = results;
    if (a && b && a.sent > 0 && b.sent > 0 && a.conversionRateBps !== b.conversionRateBps) {
      leader = a.conversionRateBps > b.conversionRateBps ? 'A' : 'B';
    }
    return {
      campaignId: row.id,
      currency: restaurant.currency,
      attributionDays: row.attributionDays,
      variants: results,
      leader,
    };
  }

  private render(body: string, restaurant: string, url: string, locale: string): string {
    const messages = BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE];
    const t = createTranslator({ locale, messages, fallback: BUNDLED_MESSAGES[BASE_LOCALE] });
    return t('messaging.template.campaign.body', { restaurant, body, url });
  }

  private async requireCampaign(restaurantId: string, campaignId: string): Promise<CampaignRow> {
    const row = await this.prisma.campaign.findFirst({
      where: { id: campaignId, restaurantId },
      select: campaignSelect,
    });
    if (!row) throw notFound('CAMPAIGN_NOT_FOUND', 'Campaign not found');
    return row;
  }

  private toDto(row: CampaignRow): CampaignDTO {
    if (row.channel !== 'SMS' && row.channel !== 'WHATSAPP' && row.channel !== 'EMAIL')
      throw badRequest('VALIDATION', 'Unsupported campaign channel');
    return {
      id: row.id,
      name: row.name,
      channel: row.channel,
      body: row.body,
      subject: row.subject,
      variant:
        row.variantBody && row.variantSharePct
          ? { body: row.variantBody, subject: row.variantSubject, sharePct: row.variantSharePct }
          : null,
      sendTimeMode: row.sendTimeMode === 'BEST_HOUR' ? 'BEST_HOUR' : 'FIXED',
      attributionDays: row.attributionDays,
      status: row.status,
      segment: this.segmentOf(row),
      segmentId: row.segmentId,
      scheduledAt: row.scheduledAt?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      audienceCount: row.audienceCount,
      sentCount: row.sentCount,
      failedCount: row.failedCount,
      skippedCount: row.skippedCount,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
