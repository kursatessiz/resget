import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { CampaignStatus, Prisma } from '@resget/database';
import {
  BASE_LOCALE,
  BUNDLED_MESSAGES,
  CAMPAIGN_BATCH_SIZE,
  CampaignSegmentSchema,
  createTranslator,
  isWithinSendWindow,
  nextSendWindowStart,
} from '@resget/shared';
import type {
  CampaignAudienceDTO,
  CampaignDTO,
  CampaignDetailDTO,
  CampaignPageDTO,
  CampaignPreviewDTO,
  CampaignSegment,
  ConsentRegistryAdapter,
  CreateCampaignInput,
  NotificationChannel,
  SendCampaignInput,
  UpdateCampaignInput,
  SavedSegmentDTO,
  SaveSegmentInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { badRequest, conflict, notFound } from '../../common/api-error';
import { CONSENT_REGISTRY } from './consent-registry';

type SegmentRow = Prisma.CampaignSegmentPresetGetPayload<Record<string, never>>;

const campaignSelect = Prisma.validator<Prisma.CampaignSelect>()({
  id: true,
  restaurantId: true,
  name: true,
  channel: true,
  body: true,
  status: true,
  segment: true,
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
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
    @Inject(CONSENT_REGISTRY) private readonly registry: ConsentRegistryAdapter,
  ) {}

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
    const row = await this.prisma.campaign.create({
      data: {
        restaurantId,
        name: input.name,
        channel: input.channel,
        body: input.body,
        segment: input.segment,
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
    const updated = await this.prisma.campaign.update({
      where: { id: row.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.segment !== undefined ? { segment: input.segment } : {}),
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
    const audienceCount = await this.prisma.restaurantCustomer.count({
      where: this.audienceWhere(restaurantId, this.segmentOf(row), now),
    });
    const wallet = await this.prisma.messageWallet.findUnique({
      where: { restaurantId_channel: { restaurantId, channel: row.channel } },
      select: { balance: true },
    });
    const balance = wallet?.balance ?? 0;
    return {
      audienceCount,
      creditsNeeded: audienceCount,
      walletBalance: balance,
      enoughCredits: balance >= audienceCount,
      renderedExample: this.render(row.body, restaurant.name, this.optOutUrl('ornek'), restaurant.defaultLocale),
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
    await this.prisma.restaurantCustomer.update({
      where: { id: customer.id },
      data: { marketingOptIn: false, marketingOptOutAt: new Date() },
    });
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
      select: { id: true, restaurantId: true, segment: true },
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
    campaign: { id: string; restaurantId: string; segment: Prisma.JsonValue },
    now: Date,
  ): Promise<void> {
    const started = await this.prisma.campaign.updateMany({
      where: { id: campaign.id, status: CampaignStatus.SCHEDULED },
      data: { status: CampaignStatus.SENDING, startedAt: now },
    });
    if (started.count === 0) return;
    const segment = CampaignSegmentSchema.safeParse(campaign.segment ?? {});
    const audience = await this.prisma.restaurantCustomer.findMany({
      where: this.audienceWhere(campaign.restaurantId, segment.success ? segment.data : {}, now),
      select: { id: true },
    });
    if (audience.length > 0) {
      await this.prisma.campaignRecipient.createMany({
        data: audience.map((c) => ({ campaignId: campaign.id, customerId: c.id })),
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
    const pending = await this.prisma.campaignRecipient.findMany({
      where: { campaignId: campaign.id, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: CAMPAIGN_BATCH_SIZE,
      select: {
        id: true,
        customer: {
          select: {
            id: true,
            marketingOptIn: true,
            marketingToken: true,
            user: { select: { phone: true, locale: true } },
          },
        },
      },
    });
    if (pending.length === 0) {
      await this.finish(campaign.id, now);
      return 0;
    }
    const channel = campaign.channel as NotificationChannel;
    const allowed = await this.registry.allowed(
      campaign.restaurant.countryCode,
      channel,
      pending.filter((r) => r.customer.marketingOptIn).map((r) => r.customer.user.phone),
    );
    let sent = 0;
    for (const recipient of pending) {
      const customer = recipient.customer;
      if (!customer.marketingOptIn || !allowed.has(customer.user.phone)) {
        await this.markRecipient(
          recipient.id,
          campaign.id,
          'SKIPPED',
          customer.marketingOptIn ? 'CONSENT_REGISTRY' : 'OPTED_OUT',
        );
        continue;
      }
      const token = customer.marketingToken ?? (await this.ensureToken(customer.id));
      const locale = customer.user.locale ?? campaign.restaurant.defaultLocale;
      const result = await this.messaging.send({
        restaurantId: campaign.restaurantId,
        channel,
        to: customer.user.phone,
        templateKey: 'campaign.body',
        params: { restaurant: campaign.restaurant.name, body: campaign.body, url: this.optOutUrl(token) },
        locale,
        billable: true,
        fallbackToSms: false,
      });
      if (result.status === 'SENT') {
        sent += 1;
        await this.markRecipient(recipient.id, campaign.id, 'SENT', null, result.logId, now);
        continue;
      }
      if (result.errorCode === 'INSUFFICIENT_CREDITS') {
        // Stop here; the campaign resumes at the next pass once credits are bought.
        await this.prisma.campaign.update({ where: { id: campaign.id }, data: { lastError: 'INSUFFICIENT_CREDITS' } });
        return sent;
      }
      await this.markRecipient(recipient.id, campaign.id, 'FAILED', result.errorCode ?? 'FAILED', result.logId);
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
  ): Prisma.RestaurantCustomerWhereInput {
    const where: Prisma.RestaurantCustomerWhereInput = { restaurantId, marketingOptIn: true };
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

  private async ensureToken(customerId: string): Promise<string> {
    const token = randomUUID();
    await this.prisma.restaurantCustomer.update({ where: { id: customerId }, data: { marketingToken: token } });
    return token;
  }

  private optOutUrl(token: string): string {
    return `${this.config.getOrThrow<string>('PUBLIC_APP_URL').replace(/\/+$/, '')}/iptal/${token}`;
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
    if (row.channel !== 'SMS' && row.channel !== 'WHATSAPP')
      throw badRequest('VALIDATION', 'Unsupported campaign channel');
    return {
      id: row.id,
      name: row.name,
      channel: row.channel,
      body: row.body,
      status: row.status,
      segment: this.segmentOf(row),
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
