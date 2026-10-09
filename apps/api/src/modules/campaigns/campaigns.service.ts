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
import { APPROVAL_RESET, CampaignGuardsService } from './campaign-guards.service';

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
  approvalStatus: true,
  approvalRequestedByUserId: true,
  approvalRequestedAt: true,
  approvalDecidedAt: true,
  approvalNote: true,
  approvalRequestedBy: { select: { fullName: true } },
  approvalDecidedBy: { select: { fullName: true } },
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
/** How long a claimed recipient is left to the runner that claimed it before another may take it over. */
const RECIPIENT_LEASE_MS = 10 * 60_000;

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly features: FeatureFlagsService,
    private readonly savedSegments: SegmentsService,
    private readonly sender: CommercialSenderService,
    private readonly guards: CampaignGuardsService,
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
    // Under approvals a new campaign is a draft until someone else approves it (docs/ONAYLAR.md).
    if (input.scheduledAt && (await this.guards.approvalsOn(restaurantId))) {
      throw conflict('CAMPAIGN_APPROVAL_REQUIRED', 'A campaign must be approved before it is scheduled');
    }
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
    await this.guards.audit(this.prisma, restaurantId, userId, 'campaign.create', row.id, {
      name: row.name,
      channel: row.channel,
      scheduled: row.status === CampaignStatus.SCHEDULED,
    });
    return this.toDto(row);
  }

  async update(
    restaurantId: string,
    campaignId: string,
    userId: string,
    input: UpdateCampaignInput,
  ): Promise<CampaignDTO> {
    const row = await this.requireCampaign(restaurantId, campaignId);
    if (row.status !== 'DRAFT' && row.status !== 'SCHEDULED') {
      throw conflict('CAMPAIGN_STATE_INVALID', 'Only a draft or scheduled campaign can be edited');
    }
    // An edit takes any approval back; under approvals a scheduled campaign also returns to draft.
    const resetApproval = row.approvalStatus !== 'NONE';
    const unschedule = row.status === 'SCHEDULED' && (await this.guards.approvalsOn(restaurantId));
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
        ...(resetApproval ? APPROVAL_RESET : {}),
        ...(unschedule ? { status: CampaignStatus.DRAFT, scheduledAt: null } : {}),
      },
      select: campaignSelect,
    });
    await this.guards.audit(this.prisma, restaurantId, userId, 'campaign.update', row.id, {
      fields: Object.keys(input),
      ...(resetApproval ? { approvalReset: row.approvalStatus } : {}),
      ...(unschedule ? { unscheduled: true } : {}),
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
    // The wallet of the channel the campaign will actually use (WhatsApp may fall back to SMS).
    const wallet =
      channel === 'EMAIL'
        ? null
        : await this.prisma.messageWallet.findUnique({
            where: { restaurantId_channel: { restaurantId, channel } },
            select: { balance: true },
          });
    const balance = wallet?.balance ?? 0;
    const limit = await this.guards.check(restaurantId, audienceCount, now);
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
      guards: {
        approvalRequired: await this.guards.approvalsOn(restaurantId),
        approval: this.guards.approvalDto(row),
        limit: limit.limit ? { ...limit.limit, usedLast24h: limit.usedLast24h } : null,
        limitBlock: limit.block,
      },
    };
  }

  /** Queues the campaign: now or at the given moment. The runner respects the send window either way. */
  async send(
    restaurantId: string,
    campaignId: string,
    userId: string,
    input: SendCampaignInput,
    now: Date = new Date(),
  ): Promise<CampaignDTO> {
    const row = await this.requireCampaign(restaurantId, campaignId);
    if (row.status !== 'DRAFT' && row.status !== 'SCHEDULED') {
      throw conflict('CAMPAIGN_STATE_INVALID', 'Campaign was already sent or cancelled');
    }
    // Approval and limits apply only under the module; without it the audience is counted when the campaign starts.
    let audienceCount: number | null = null;
    if (await this.guards.approvalsOn(restaurantId)) {
      if (row.approvalStatus !== 'APPROVED') {
        throw conflict('CAMPAIGN_APPROVAL_REQUIRED', 'The campaign has not been approved');
      }
      const channel = await this.sender.effectiveChannel(restaurantId, row.channel as CampaignChannel);
      audienceCount = await this.prisma.restaurantCustomer.count({
        where: await this.campaignAudienceWhere(restaurantId, row, now, channel),
      });
      const limit = await this.guards.check(restaurantId, audienceCount, now);
      if (limit.block) {
        await this.guards.audit(this.prisma, restaurantId, userId, 'campaign.limit_blocked', row.id, {
          block: limit.block,
          audienceCount,
          usedLast24h: limit.usedLast24h,
        });
        throw conflict('SEND_LIMIT_EXCEEDED', `The campaign goes over the ${limit.block} limit`);
      }
    }
    if (row.channel === 'EMAIL') {
      const blocker = await this.sender.emailBlocker(restaurantId, ['campaigns_v2']);
      if (blocker === 'FEATURE_DISABLED') throw forbidden('FEATURE_DISABLED', 'Email campaigns are switched off');
      if (blocker) throw conflict(blocker, 'No verified sending domain');
    }
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : now;
    // Only from the state read above: a campaign started or cancelled meanwhile is not queued again.
    const queued = await this.prisma.campaign.updateMany({
      where: { id: row.id, status: { in: [CampaignStatus.DRAFT, CampaignStatus.SCHEDULED] } },
      data: { status: CampaignStatus.SCHEDULED, scheduledAt, lastError: null },
    });
    if (queued.count === 0) throw conflict('CAMPAIGN_STATE_INVALID', 'Campaign was already sent or cancelled');
    const updated = await this.prisma.campaign.findUniqueOrThrow({ where: { id: row.id }, select: campaignSelect });
    await this.guards.audit(this.prisma, restaurantId, userId, 'campaign.send', row.id, {
      ...(audienceCount !== null ? { audienceCount } : {}),
      scheduledAt: scheduledAt.toISOString(),
    });
    return this.toDto(updated);
  }

  // -- Approvals (docs/ONAYLAR.md) -------------------------------------------------------------

  async requestApproval(restaurantId: string, campaignId: string, userId: string): Promise<CampaignDTO> {
    await this.features.assertEnabled('marketing_approvals', restaurantId);
    const row = await this.requireCampaign(restaurantId, campaignId);
    if (row.status !== 'DRAFT' || (row.approvalStatus !== 'NONE' && row.approvalStatus !== 'REJECTED')) {
      throw conflict('CAMPAIGN_STATE_INVALID', 'Only a draft without a pending or given approval can be submitted');
    }
    const updated = await this.prisma.campaign.update({
      where: { id: row.id },
      data: {
        ...APPROVAL_RESET,
        approvalStatus: 'PENDING',
        approvalRequestedByUserId: userId,
        approvalRequestedAt: new Date(),
      },
      select: campaignSelect,
    });
    await this.guards.audit(this.prisma, restaurantId, userId, 'campaign.approval.request', row.id);
    return this.toDto(updated);
  }

  /** Approve or reject a pending request; never the requester's own (four eyes). */
  async decideApproval(
    restaurantId: string,
    campaignId: string,
    userId: string,
    decision: { approve: true } | { approve: false; note: string },
  ): Promise<CampaignDTO> {
    await this.features.assertEnabled('marketing_approvals', restaurantId);
    const row = await this.requireCampaign(restaurantId, campaignId);
    if (row.status !== 'DRAFT' || row.approvalStatus !== 'PENDING') {
      throw conflict('CAMPAIGN_STATE_INVALID', 'No pending approval request');
    }
    if (row.approvalRequestedByUserId === userId) {
      throw forbidden('APPROVAL_SELF_FORBIDDEN', 'The requester cannot decide on their own request');
    }
    // Conditional on the state read above, so two deciders cannot both win.
    const changed = await this.prisma.campaign.updateMany({
      where: { id: row.id, approvalStatus: 'PENDING' },
      data: {
        approvalStatus: decision.approve ? 'APPROVED' : 'REJECTED',
        approvalDecidedByUserId: userId,
        approvalDecidedAt: new Date(),
        approvalNote: decision.approve ? null : decision.note,
      },
    });
    if (changed.count === 0) throw conflict('CAMPAIGN_STATE_INVALID', 'No pending approval request');
    await this.guards.audit(
      this.prisma,
      restaurantId,
      userId,
      decision.approve ? 'campaign.approval.approve' : 'campaign.approval.reject',
      row.id,
      decision.approve ? undefined : { note: decision.note },
    );
    return this.toDto(await this.requireCampaign(restaurantId, campaignId));
  }

  async cancel(restaurantId: string, campaignId: string, userId: string): Promise<CampaignDTO> {
    const row = await this.requireCampaign(restaurantId, campaignId);
    if (row.status === 'SENT' || row.status === 'CANCELLED') {
      throw conflict('CAMPAIGN_STATE_INVALID', 'Campaign is already finished');
    }
    const updated = await this.prisma.campaign.update({
      where: { id: row.id },
      data: { status: CampaignStatus.CANCELLED, finishedAt: new Date() },
      select: campaignSelect,
    });
    await this.guards.audit(this.prisma, restaurantId, userId, 'campaign.cancel', row.id, { from: row.status });
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
        approvalStatus: true,
        restaurant: { select: { timezone: true } },
      },
      take: 20,
    });
    for (const campaign of due) await this.start(campaign, now);

    // Every sending campaign gets its batch; a fixed page would let campaigns waiting for their send window or
    // for credits take every slot and starve the rest.
    const sending = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.SENDING },
      select: {
        ...campaignSelect,
        restaurant: { select: { name: true, countryCode: true, timezone: true, defaultLocale: true } },
      },
      orderBy: { startedAt: 'asc' },
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
      approvalStatus: string;
      restaurant: { timezone: string };
    },
    now: Date,
  ): Promise<void> {
    const channel = await this.sender.effectiveChannel(campaign.restaurantId, campaign.channel as CampaignChannel);
    const audience = await this.prisma.restaurantCustomer.findMany({
      where: await this.campaignAudienceWhere(campaign.restaurantId, campaign, now, channel),
      select: { id: true },
    });
    // Checked again at start: approvals may have been switched on, or the audience grown, since it was queued.
    const held = await this.holdAtStart(campaign, audience.length, now);
    if (held) return;
    const due =
      audience.length > 0 && campaign.sendTimeMode === 'BEST_HOUR'
        ? await this.bestHourDue(
            campaign.restaurantId,
            campaign.restaurant.timezone,
            audience.map((c) => c.id),
            now,
          )
        : new Map<string, Date>();
    // The status change and the recipients commit together: a campaign is never SENDING without its recipients
    // (which the next batch would read as "nothing left" and mark sent), and only one starter wins.
    const started = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.campaign.updateMany({
        where: { id: campaign.id, status: CampaignStatus.SCHEDULED },
        data: { status: CampaignStatus.SENDING, startedAt: now, audienceCount: audience.length },
      });
      if (claimed.count === 0) return false;
      if (audience.length > 0) {
        await tx.campaignRecipient.createMany({
          data: audience.map((c) => ({
            campaignId: campaign.id,
            customerId: c.id,
            variant: abVariantFor(campaign.id, c.id, campaign.variantSharePct),
            dueAt: due.get(c.id) ?? null,
          })),
          skipDuplicates: true,
        });
      }
      return true;
    });
    if (started && audience.length === 0) await this.finish(campaign.id, now);
  }

  /** Puts a campaign that may not start back to draft with the reason; true when it was held. */
  private async holdAtStart(
    campaign: { id: string; restaurantId: string; approvalStatus: string },
    audienceCount: number,
    now: Date,
  ): Promise<boolean> {
    if (!(await this.guards.approvalsOn(campaign.restaurantId))) return false;
    let reason: 'CAMPAIGN_APPROVAL_REQUIRED' | 'SEND_LIMIT_EXCEEDED' | null = null;
    let meta: Prisma.InputJsonObject = { audienceCount };
    if (campaign.approvalStatus !== 'APPROVED') {
      reason = 'CAMPAIGN_APPROVAL_REQUIRED';
    } else {
      const limit = await this.guards.check(campaign.restaurantId, audienceCount, now);
      if (limit.block) {
        reason = 'SEND_LIMIT_EXCEEDED';
        meta = { audienceCount, block: limit.block, usedLast24h: limit.usedLast24h };
      }
    }
    if (!reason) return false;
    const held = await this.prisma.campaign.updateMany({
      where: { id: campaign.id, status: CampaignStatus.SCHEDULED },
      data: { status: CampaignStatus.DRAFT, startedAt: null, scheduledAt: null, lastError: reason },
    });
    if (held.count === 0) return true;
    await this.guards.audit(this.prisma, campaign.restaurantId, null, 'campaign.held', campaign.id, {
      ...meta,
      reason,
    });
    return true;
  }

  private async sendBatch(
    campaign: CampaignRow & {
      restaurant: { name: string; countryCode: string; timezone: string; defaultLocale: string };
    },
    now: Date,
  ): Promise<number> {
    // BEST_HOUR recipients wait for their hour; the others are due at once.
    const leaseCutoff = new Date(now.getTime() - RECIPIENT_LEASE_MS);
    const pending = await this.prisma.campaignRecipient.findMany({
      where: {
        campaignId: campaign.id,
        status: 'PENDING',
        AND: [
          { OR: [{ dueAt: null }, { dueAt: { lte: now } }] },
          // A recipient another runner has claimed (sentAt set while PENDING) is left to it until the lease runs out.
          { OR: [{ sentAt: null }, { sentAt: { lt: leaseCutoff } }] },
        ],
      },
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
      // Claim before anything is sent, so two runners never message (and charge) the same person twice.
      const claimed = await this.prisma.campaignRecipient.updateMany({
        where: {
          id: recipient.id,
          status: 'PENDING',
          OR: [{ sentAt: null }, { sentAt: { lt: leaseCutoff } }],
        },
        data: { sentAt: now },
      });
      if (claimed.count === 0) continue;
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
        // Stop here; the campaign resumes at the next pass once credits are bought. The claim is released.
        await this.prisma.campaignRecipient.updateMany({
          where: { id: recipient.id, status: 'PENDING' },
          data: { sentAt: null },
        });
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
      approval: this.guards.approvalDto(row),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
