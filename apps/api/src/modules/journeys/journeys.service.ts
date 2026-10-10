import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@resget/database';
import {
  CONVERSION_EXCLUDED_ORDER_STATUSES,
  JOURNEY_BATCH_SIZE,
  JOURNEY_COOLDOWN_DAYS,
  JOURNEY_DEFAULT_DELAY_HOURS,
  JOURNEY_INACTIVE_DAYS,
  JOURNEY_SCAN_INTERVAL_MINUTES,
  ORDER_JOURNEY_TRIGGERS,
  canRateOrder,
  firstNameOf,
  isWithinSendWindow,
  journeyContentIssue,
  renderJourneyBody,
  trackingUrl,
} from '@resget/shared';
import type {
  CampaignChannel,
  CreateJourneyInput,
  JourneyDTO,
  JourneyListDTO,
  JourneyRunStatus,
  JourneyStatsDTO,
  JourneyTrigger,
  OrderStatusValue,
  UpdateJourneyInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { SegmentsService } from '../segments/segments.service';
import { CommercialSenderService } from '../campaigns/commercial-sender.service';
import type { CommercialRecipient } from '../campaigns/commercial-sender.service';
import { APPROVAL_RESET, CampaignGuardsService } from '../campaigns/campaign-guards.service';
import { badRequest, conflict, forbidden, notFound } from '../../common/api-error';

type JourneyRow = Prisma.JourneyGetPayload<object>;

/** The names behind a flow's approval, for the list. */
const journeyInclude = {
  approvalRequestedBy: { select: { fullName: true } },
  approvalDecidedBy: { select: { fullName: true } },
} as const satisfies Prisma.JourneyInclude;
type JourneyWithApproval = Prisma.JourneyGetPayload<{ include: typeof journeyInclude }>;

/** Why the runner holds a flow under marketing_approvals; recorded as journey.held when it starts. */
const GUARD_HOLDS: readonly string[] = ['JOURNEY_APPROVAL_REQUIRED', 'SEND_LIMIT_EXCEEDED'];

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** A pending message more than this late is dropped rather than sent out of context. */
const RUN_EXPIRY_DAYS = 7;
const COMPLETED = ['DELIVERED', 'PICKED_UP'] as const;

/**
 * Automated flows (docs/AKISLAR.md). Order triggers enrol a customer inside
 * the order's completion transaction; WIN_BACK is scanned by the runner. A
 * run waits until it is due, then goes through the shared commercial sender
 * inside the restaurant's send window. A run whose reason is gone (the order
 * was cancelled or rated, the customer ordered again) is cancelled instead.
 */
@Injectable()
export class JourneysService {
  private readonly logger = new Logger(JourneysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly segments: SegmentsService,
    private readonly sender: CommercialSenderService,
    private readonly guards: CampaignGuardsService,
  ) {}

  // -- Management ---------------------------------------------------------------------

  async list(restaurantId: string): Promise<JourneyListDTO> {
    const [restaurant, rows, approvalRequired] = await Promise.all([
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { currency: true } }),
      this.prisma.journey.findMany({ where: { restaurantId }, orderBy: { createdAt: 'asc' }, include: journeyInclude }),
      this.guards.approvalsOn(restaurantId),
    ]);
    const stats = await this.stats(rows.map((r) => r.id));
    return {
      currency: restaurant.currency,
      approvalRequired,
      items: rows.map((row) => this.toDto(row, stats.get(row.id))),
    };
  }

  async create(restaurantId: string, userId: string, input: CreateJourneyInput): Promise<JourneyDTO> {
    await this.checkChannelAndSegment(restaurantId, input.channel, input.segmentId ?? null);
    const row = await this.prisma.journey.create({
      data: {
        restaurantId,
        name: input.name,
        trigger: input.trigger,
        channel: input.channel,
        subject: input.channel === 'EMAIL' ? (input.subject ?? null) : null,
        body: input.body,
        delayHours: input.delayHours ?? JOURNEY_DEFAULT_DELAY_HOURS[input.trigger],
        inactiveDays: input.trigger === 'WIN_BACK' ? (input.inactiveDays ?? JOURNEY_INACTIVE_DAYS.default) : null,
        cooldownDays: input.cooldownDays ?? JOURNEY_COOLDOWN_DAYS.default,
        ...(input.attributionDays !== undefined ? { attributionDays: input.attributionDays } : {}),
        segmentId: input.segmentId ?? null,
        createdByUserId: userId,
        contentUpdatedByUserId: userId,
        contentUpdatedAt: new Date(),
      },
      include: journeyInclude,
    });
    await this.audit(restaurantId, userId, 'journey.create', row.id, {
      name: row.name,
      trigger: row.trigger,
      channel: row.channel,
    });
    return this.toDto(row, undefined);
  }

  /**
   * Under marketing_approvals (docs/ONAYLAR.md) switching a flow on, or changing what an active flow sends or to
   * whom, asks for approval; the runner holds it until someone other than the last editor approves. A content
   * change takes any approval back, with or without the module.
   */
  async update(
    restaurantId: string,
    journeyId: string,
    userId: string,
    input: UpdateJourneyInput,
  ): Promise<JourneyDTO> {
    const row = await this.require(restaurantId, journeyId);
    const channel = input.channel ?? (row.channel as CampaignChannel);
    const subject = input.subject === undefined ? row.subject : input.subject;
    const issue = journeyContentIssue({
      trigger: row.trigger as JourneyTrigger,
      channel,
      body: input.body ?? row.body,
      subject,
    });
    if (issue) throw badRequest('JOURNEY_CONTENT_INVALID', `Flow content: ${issue}`);
    const segmentId = input.segmentId === undefined ? row.segmentId : input.segmentId;
    if (input.channel !== undefined || input.segmentId !== undefined) {
      await this.checkChannelAndSegment(restaurantId, channel, segmentId);
    }
    const status = input.status ?? row.status;
    // An email flow is switched on only when it can actually send.
    if (status === 'ACTIVE' && channel === 'EMAIL') {
      const blocker = await this.sender.emailBlocker(restaurantId, ['journeys']);
      if (blocker === 'FEATURE_DISABLED') throw forbidden('FEATURE_DISABLED', 'Email is switched off');
      if (blocker) throw conflict(blocker, 'No verified sending domain');
    }
    const now = new Date();
    const changed = this.contentChanges(row, input, channel, subject, segmentId);
    const activating = status === 'ACTIVE' && row.status !== 'ACTIVE';
    // A content change always resets the approval: an approval given meanwhile was for the old content.
    const approvalAfter = changed.length > 0 ? 'NONE' : row.approvalStatus;
    const requestApproval =
      status === 'ACTIVE' &&
      (activating || changed.length > 0) &&
      (approvalAfter === 'NONE' || approvalAfter === 'REJECTED') &&
      (await this.guards.approvalsOn(restaurantId));
    const updated = await this.prisma.journey.update({
      where: { id: row.id },
      include: journeyInclude,
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        subject: channel === 'EMAIL' ? subject : null,
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.delayHours !== undefined ? { delayHours: input.delayHours } : {}),
        ...(input.inactiveDays !== undefined && row.trigger === 'WIN_BACK' ? { inactiveDays: input.inactiveDays } : {}),
        ...(input.cooldownDays !== undefined ? { cooldownDays: input.cooldownDays } : {}),
        ...(input.attributionDays !== undefined ? { attributionDays: input.attributionDays } : {}),
        ...(input.segmentId !== undefined ? { segmentId: input.segmentId } : {}),
        ...(input.status !== undefined ? { status: input.status, lastError: null } : {}),
        ...(changed.length > 0 ? { ...APPROVAL_RESET, contentUpdatedByUserId: userId, contentUpdatedAt: now } : {}),
        ...(requestApproval
          ? {
              ...APPROVAL_RESET,
              approvalStatus: 'PENDING' as const,
              approvalRequestedByUserId: userId,
              approvalRequestedAt: now,
            }
          : {}),
      },
    });
    await this.audit(restaurantId, userId, 'journey.update', row.id, {
      fields: Object.keys(input),
      ...(changed.length > 0 ? { content: changed } : {}),
      ...(changed.length > 0 && row.approvalStatus !== 'NONE' ? { approvalReset: row.approvalStatus } : {}),
    });
    if (status !== row.status) {
      await this.audit(restaurantId, userId, status === 'ACTIVE' ? 'journey.activate' : 'journey.pause', row.id);
    }
    if (requestApproval) await this.audit(restaurantId, userId, 'journey.approval.request', row.id);
    const stats = await this.stats([updated.id]);
    return this.toDto(updated, stats.get(updated.id));
  }

  async remove(restaurantId: string, journeyId: string, userId: string): Promise<void> {
    const row = await this.require(restaurantId, journeyId);
    await this.prisma.journey.delete({ where: { id: row.id } });
    await this.audit(restaurantId, userId, 'journey.delete', row.id, { name: row.name });
  }

  /** The fields that change what the flow sends or to whom; the name and the attribution window do not. */
  private contentChanges(
    row: JourneyRow,
    input: UpdateJourneyInput,
    channel: CampaignChannel,
    subject: string | null,
    segmentId: string | null,
  ): string[] {
    const changed: string[] = [];
    if (channel !== row.channel) changed.push('channel');
    if ((channel === 'EMAIL' ? subject : null) !== row.subject) changed.push('subject');
    if (input.body !== undefined && input.body !== row.body) changed.push('body');
    if (input.delayHours !== undefined && input.delayHours !== row.delayHours) changed.push('delayHours');
    if (input.inactiveDays !== undefined && row.trigger === 'WIN_BACK' && input.inactiveDays !== row.inactiveDays) {
      changed.push('inactiveDays');
    }
    if (input.cooldownDays !== undefined && input.cooldownDays !== row.cooldownDays) changed.push('cooldownDays');
    if (segmentId !== row.segmentId) changed.push('segmentId');
    return changed;
  }

  // -- Approvals (docs/ONAYLAR.md) ------------------------------------------------------

  /**
   * Approve or reject the flow's current content; never by the person who last changed it (four eyes). A flow
   * without a decision (NONE or PENDING) can be decided; a rejected one asks again when it is edited or switched on.
   */
  async decideApproval(
    restaurantId: string,
    journeyId: string,
    userId: string,
    decision: { approve: true } | { approve: false; note: string },
  ): Promise<JourneyDTO> {
    await this.features.assertEnabled('marketing_approvals', restaurantId);
    const row = await this.require(restaurantId, journeyId);
    if (row.approvalStatus !== 'NONE' && row.approvalStatus !== 'PENDING') {
      throw conflict('JOURNEY_STATE_INVALID', 'The flow has no open approval');
    }
    if ((row.contentUpdatedByUserId ?? row.createdByUserId) === userId) {
      throw forbidden('APPROVAL_SELF_FORBIDDEN', 'The author cannot decide on their own content');
    }
    // Conditional on the state and the content read above: two deciders cannot both win, and an edit made
    // meanwhile is never approved unseen.
    const now = new Date();
    const decided = await this.prisma.journey.updateMany({
      where: { id: row.id, approvalStatus: row.approvalStatus, contentUpdatedAt: row.contentUpdatedAt },
      data: {
        approvalStatus: decision.approve ? 'APPROVED' : 'REJECTED',
        approvalDecidedByUserId: userId,
        approvalDecidedAt: now,
        approvalNote: decision.approve ? null : decision.note,
        ...(decision.approve && row.lastError === 'JOURNEY_APPROVAL_REQUIRED' ? { lastError: null } : {}),
        // The runner skipped the win-back scan while the flow waited; the next pass scans it at once.
        ...(decision.approve ? { lastScanAt: null } : {}),
      },
    });
    if (decided.count === 0) throw conflict('JOURNEY_STATE_INVALID', 'The flow changed meanwhile');
    await this.audit(
      restaurantId,
      userId,
      decision.approve ? 'journey.approval.approve' : 'journey.approval.reject',
      row.id,
      decision.approve ? undefined : { note: decision.note },
    );
    const updated = await this.prisma.journey.findUniqueOrThrow({ where: { id: row.id }, include: journeyInclude });
    const stats = await this.stats([updated.id]);
    return this.toDto(updated, stats.get(updated.id));
  }

  /** Flow actions go to the audit log in every tenant, whether or not approvals are on (as campaign.*). */
  private async audit(
    restaurantId: string,
    actorUserId: string | null,
    action: string,
    journeyId: string,
    meta?: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: { restaurantId, actorUserId, action, entity: 'journey', entityId: journeyId, ...(meta ? { meta } : {}) },
    });
  }

  private async checkChannelAndSegment(
    restaurantId: string,
    channel: CampaignChannel,
    segmentId: string | null,
  ): Promise<void> {
    if (channel === 'EMAIL') await this.features.assertEnabled('email_channel', restaurantId);
    if (segmentId) {
      await this.features.assertEnabled('segments_v2', restaurantId);
      await this.segments.require(restaurantId, segmentId);
    }
  }

  private async require(restaurantId: string, journeyId: string): Promise<JourneyRow> {
    const row = await this.prisma.journey.findFirst({ where: { id: journeyId, restaurantId } });
    if (!row) throw notFound('JOURNEY_NOT_FOUND', 'Flow not found');
    return row;
  }

  // -- Enrolment ----------------------------------------------------------------------

  /**
   * Called in the transaction that completes an order: each active order flow
   * of the restaurant takes the customer in, unless the segment leaves them
   * out or the cooldown holds. At most one run per flow and order.
   */
  async recordCompletion(tx: Prisma.TransactionClient, orderId: string, now: Date): Promise<number> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { restaurantId: true, customerUserId: true },
    });
    if (!order?.customerUserId) return 0;
    if (!(await this.features.isEnabled('journeys', order.restaurantId))) return 0;
    const journeys = await tx.journey.findMany({
      where: { restaurantId: order.restaurantId, status: 'ACTIVE', trigger: { in: [...ORDER_JOURNEY_TRIGGERS] } },
    });
    if (journeys.length === 0) return 0;
    const customer = await tx.restaurantCustomer.findUnique({
      where: { restaurantId_userId: { restaurantId: order.restaurantId, userId: order.customerUserId } },
      select: { id: true },
    });
    if (!customer) return 0;
    let enrolled = 0;
    for (const journey of journeys) {
      if (journey.trigger === 'FIRST_ORDER') {
        const completed = await tx.order.count({
          where: {
            restaurantId: order.restaurantId,
            customerUserId: order.customerUserId,
            status: { in: [...COMPLETED] },
          },
        });
        if (completed !== 1) continue;
      }
      if (!(await this.admits(tx, journey, customer.id, now))) continue;
      const created = await tx.journeyRun.createMany({
        data: [
          {
            journeyId: journey.id,
            customerId: customer.id,
            orderId,
            dueAt: new Date(now.getTime() + journey.delayHours * HOUR_MS),
          },
        ],
        skipDuplicates: true,
      });
      enrolled += created.count;
    }
    return enrolled;
  }

  /** The segment (when set) must match the customer now, and no run of this flow may be within the cooldown. */
  private async admits(
    tx: Prisma.TransactionClient,
    journey: JourneyRow,
    customerId: string,
    now: Date,
  ): Promise<boolean> {
    if (journey.segmentId) {
      const segment = await tx.segment.findFirst({
        where: { id: journey.segmentId, restaurantId: journey.restaurantId },
      });
      // A segment that has gone admits no one; it never falls back to everyone.
      if (!segment) return false;
      const inside = await tx.restaurantCustomer.count({
        where: { AND: [this.segments.audienceWhere(segment, now), { id: customerId }] },
      });
      if (inside === 0) return false;
    }
    if (journey.cooldownDays > 0) {
      const recent = await tx.journeyRun.count({
        where: {
          journeyId: journey.id,
          customerId,
          createdAt: { gte: new Date(now.getTime() - journey.cooldownDays * DAY_MS) },
        },
      });
      if (recent > 0) return false;
    }
    return true;
  }

  /**
   * WIN_BACK: customers whose last order is between N and 2N days old and who
   * have not been in this flow for max(cooldown, N) days. The window keeps a
   * newly switched-on flow from messaging customers lost years ago.
   */
  async scanWinBack(journey: JourneyRow, now: Date): Promise<number> {
    const days = journey.inactiveDays ?? JOURNEY_INACTIVE_DAYS.default;
    const quiet = Math.max(journey.cooldownDays, days);
    const where: Prisma.RestaurantCustomerWhereInput = {
      restaurantId: journey.restaurantId,
      user: { deletedAt: null },
      lastOrderAt: { lt: new Date(now.getTime() - days * DAY_MS), gte: new Date(now.getTime() - 2 * days * DAY_MS) },
      journeyRuns: { none: { journeyId: journey.id, createdAt: { gte: new Date(now.getTime() - quiet * DAY_MS) } } },
    };
    let audience: Prisma.RestaurantCustomerWhereInput = where;
    if (journey.segmentId) {
      const segment = await this.prisma.segment.findFirst({
        where: { id: journey.segmentId, restaurantId: journey.restaurantId },
      });
      if (!segment) return 0;
      audience = { AND: [where, this.segments.audienceWhere(segment, now)] };
    }
    const customers = await this.prisma.restaurantCustomer.findMany({
      where: audience,
      select: { id: true },
      take: 1000,
    });
    if (customers.length === 0) return 0;
    const created = await this.prisma.journeyRun.createMany({
      data: customers.map((c) => ({
        journeyId: journey.id,
        customerId: c.id,
        dueAt: new Date(now.getTime() + journey.delayHours * HOUR_MS),
      })),
    });
    return created.count;
  }

  // -- Runner -------------------------------------------------------------------------

  /** One pass: expire stale runs, scan win-back flows that are due a scan, send due runs. Returns messages sent. */
  async runPass(now: Date = new Date()): Promise<number> {
    await this.prisma.journeyRun.updateMany({
      where: { status: 'PENDING', dueAt: { lt: new Date(now.getTime() - RUN_EXPIRY_DAYS * DAY_MS) } },
      data: { status: 'CANCELLED', errorCode: 'EXPIRED' },
    });

    const toScan = await this.prisma.journey.findMany({
      where: {
        status: 'ACTIVE',
        trigger: 'WIN_BACK',
        OR: [
          { lastScanAt: null },
          { lastScanAt: { lt: new Date(now.getTime() - JOURNEY_SCAN_INTERVAL_MINUTES * 60_000) } },
        ],
      },
      take: 20,
    });
    for (const journey of toScan) {
      // Stamped even when the module is off, so switched-off flows do not hold the 20 scan slots for ever.
      await this.prisma.journey.update({ where: { id: journey.id }, data: { lastScanAt: now } });
      if (!(await this.features.isEnabled('journeys', journey.restaurantId))) continue;
      // A flow waiting for approval takes no one in yet; it starts from the window as it is once approved.
      if (await this.awaitsApproval(journey)) continue;
      await this.scanWinBack(journey, now);
    }

    // Each flow with due runs gets its own batch: a fixed page of the oldest runs would let flows that cannot send
    // (no credits, outside the send window, email domain missing) take every slot and starve the others.
    const dueWhere = { status: 'PENDING' as const, dueAt: { lte: now }, journey: { status: 'ACTIVE' as const } };
    const flowsDue = await this.prisma.journeyRun.groupBy({ by: ['journeyId'], where: dueWhere });
    const due = (
      await Promise.all(
        flowsDue.map((flow) =>
          this.prisma.journeyRun.findMany({
            where: { ...dueWhere, journeyId: flow.journeyId },
            orderBy: { dueAt: 'asc' },
            take: JOURNEY_BATCH_SIZE,
            select: {
              id: true,
              createdAt: true,
              journey: true,
              order: {
                select: {
                  status: true,
                  completedAt: true,
                  trackingToken: true,
                  rating: { select: { id: true } },
                },
              },
              customer: {
                select: {
                  id: true,
                  email: true,
                  marketingToken: true,
                  lastOrderAt: true,
                  user: { select: { phone: true, email: true, locale: true, fullName: true } },
                  restaurant: {
                    select: { name: true, countryCode: true, timezone: true, defaultLocale: true },
                  },
                },
              },
            },
          }),
        ),
      )
    ).flat();
    const blocked = new Set<string>();
    // Messages each tenant may still send in this pass under its 24-hour limit (null: no limit), read once.
    const left = new Map<string, number | null>();
    let sent = 0;
    for (const run of due) {
      const journey = run.journey;
      const restaurant = run.customer.restaurant;
      if (blocked.has(journey.id)) continue;
      if (!isWithinSendWindow(now, restaurant.timezone)) continue;
      const hold = await this.holdReason(journey);
      if (hold) {
        blocked.add(journey.id);
        await this.hold(journey, hold);
        continue;
      }
      const exit = await this.exitReason(journey, run, now);
      if (exit) {
        await this.finishRun(run.id, 'CANCELLED', exit);
        continue;
      }
      const channel = await this.sender.effectiveChannel(journey.restaurantId, journey.channel as CampaignChannel);
      const recipient: CommercialRecipient = {
        customerId: run.customer.id,
        phone: run.customer.user.phone,
        email: run.customer.email ?? run.customer.user.email ?? null,
        locale: run.customer.user.locale,
        marketingToken: run.customer.marketingToken,
      };
      const refusal =
        (await this.sender.check(journey.restaurantId, restaurant.countryCode, channel, [recipient], now)).get(
          recipient.customerId,
        ) ?? null;
      if (refusal !== null) {
        await this.finishRun(run.id, 'SKIPPED', refusal);
        continue;
      }
      // Flow messages share the tenant's rolling 24-hour limit with campaigns (docs/ONAYLAR.md); at the limit
      // the flow waits and resumes as the window moves on.
      if (!left.has(journey.restaurantId)) {
        left.set(journey.restaurantId, await this.guards.flowMessagesLeft(journey.restaurantId, now));
      }
      const budget = left.get(journey.restaurantId) ?? null;
      if (budget !== null && budget <= 0) {
        blocked.add(journey.id);
        await this.hold(journey, 'SEND_LIMIT_EXCEEDED');
        continue;
      }
      const body = renderJourneyBody(journey.body, {
        name: firstNameOf(run.customer.user.fullName),
        restaurant: restaurant.name,
        link: run.order?.trackingToken ? trackingUrl(this.sender.publicUrl(), run.order.trackingToken) : null,
      });
      const result = await this.sender.deliver({
        restaurantId: journey.restaurantId,
        restaurantName: restaurant.name,
        defaultLocale: restaurant.defaultLocale,
        channel,
        recipient,
        body,
        subject: journey.subject,
      });
      if (result.status === 'SENT') {
        sent += 1;
        if (budget !== null) left.set(journey.restaurantId, budget - 1);
        await this.prisma.journeyRun.update({
          where: { id: run.id },
          data: { status: 'SENT', sentAt: now, messageLogId: result.logId, errorCode: null },
        });
        if (journey.lastError)
          await this.prisma.journey.update({ where: { id: journey.id }, data: { lastError: null } });
        continue;
      }
      if (result.errorCode === 'INSUFFICIENT_CREDITS') {
        // The run stays pending; the flow resumes once credits are bought.
        blocked.add(journey.id);
        await this.prisma.journey.update({ where: { id: journey.id }, data: { lastError: 'INSUFFICIENT_CREDITS' } });
        continue;
      }
      await this.finishRun(run.id, result.status === 'SKIPPED' ? 'SKIPPED' : 'FAILED', result.errorCode, result.logId);
    }
    return sent;
  }

  /** Why a flow cannot send at all right now; its runs wait. */
  private async holdReason(journey: JourneyRow): Promise<string | null> {
    if (!(await this.features.isEnabled('journeys', journey.restaurantId))) return 'FEATURE_DISABLED';
    if (await this.awaitsApproval(journey)) return 'JOURNEY_APPROVAL_REQUIRED';
    if (journey.channel === 'EMAIL') return this.sender.emailBlocker(journey.restaurantId, ['journeys']);
    return null;
  }

  /** Under marketing_approvals only an approved flow sends; this also holds flows switched on before the module. */
  private async awaitsApproval(journey: JourneyRow): Promise<boolean> {
    return journey.approvalStatus !== 'APPROVED' && (await this.guards.approvalsOn(journey.restaurantId));
  }

  /** Shows why the flow waits; an approval or limit hold is also recorded once when it starts. */
  private async hold(journey: JourneyRow, reason: string): Promise<void> {
    if (journey.lastError === reason) return;
    await this.prisma.journey.update({ where: { id: journey.id }, data: { lastError: reason } });
    if (GUARD_HOLDS.includes(reason))
      await this.audit(journey.restaurantId, null, 'journey.held', journey.id, { reason });
  }

  /** Why this run no longer makes sense: the order did not become a sale, was rated, or the customer came back. */
  private async exitReason(
    journey: JourneyRow,
    run: {
      createdAt: Date;
      order: {
        status: OrderStatusValue;
        completedAt: Date | null;
        trackingToken: string | null;
        rating: { id: string } | null;
      } | null;
      customer: { lastOrderAt: Date | null };
    },
    now: Date,
  ): Promise<string | null> {
    if (journey.trigger === 'WIN_BACK') {
      return run.customer.lastOrderAt && run.customer.lastOrderAt > run.createdAt ? 'ORDERED_AGAIN' : null;
    }
    if (!run.order) return 'ORDER_GONE';
    if ((CONVERSION_EXCLUDED_ORDER_STATUSES as readonly string[]).includes(run.order.status)) return 'ORDER_CANCELLED';
    if (journey.trigger === 'REVIEW_REQUEST') {
      if (!(await this.features.isEnabled('ratings', journey.restaurantId))) return 'RATINGS_OFF';
      if (!canRateOrder(run.order.status, run.order.completedAt, run.order.rating !== null, now)) {
        return run.order.rating ? 'ALREADY_RATED' : 'RATING_CLOSED';
      }
    }
    return null;
  }

  private async finishRun(
    runId: string,
    status: Exclude<JourneyRunStatus, 'PENDING' | 'SENT'>,
    errorCode: string | null,
    logId?: string | null,
  ): Promise<void> {
    await this.prisma.journeyRun.update({
      where: { id: runId },
      data: { status, errorCode, messageLogId: logId ?? null },
    });
  }

  // -- Reading ------------------------------------------------------------------------

  private async stats(journeyIds: string[]): Promise<Map<string, JourneyStatsDTO>> {
    const result = new Map<string, JourneyStatsDTO>();
    if (journeyIds.length === 0) return result;
    const [grouped, converted] = await Promise.all([
      this.prisma.journeyRun.groupBy({
        by: ['journeyId', 'status'],
        where: { journeyId: { in: journeyIds } },
        _count: { _all: true },
      }),
      this.prisma.journeyRun.findMany({
        where: {
          journeyId: { in: journeyIds },
          convertedOrderId: { not: null },
          convertedOrder: { status: { notIn: [...CONVERSION_EXCLUDED_ORDER_STATUSES] } },
        },
        select: { journeyId: true, revenueMinor: true },
      }),
    ]);
    for (const id of journeyIds) {
      const count = (status: JourneyRunStatus) =>
        grouped.filter((g) => g.journeyId === id && g.status === status).reduce((n, g) => n + g._count._all, 0);
      const mine = converted.filter((c) => c.journeyId === id);
      result.set(id, {
        pending: count('PENDING'),
        sent: count('SENT'),
        skipped: count('SKIPPED'),
        failed: count('FAILED'),
        cancelled: count('CANCELLED'),
        conversions: mine.length,
        revenueMinor: mine.reduce((n, c) => n + (c.revenueMinor ?? 0), 0),
      });
    }
    return result;
  }

  private toDto(row: JourneyWithApproval, stats: JourneyStatsDTO | undefined): JourneyDTO {
    if (row.channel !== 'SMS' && row.channel !== 'WHATSAPP' && row.channel !== 'EMAIL') {
      this.logger.warn(`flow ${row.id} has an unsupported channel ${row.channel}`);
    }
    return {
      id: row.id,
      name: row.name,
      trigger: row.trigger as JourneyTrigger,
      channel: row.channel as CampaignChannel,
      subject: row.subject,
      body: row.body,
      delayHours: row.delayHours,
      inactiveDays: row.inactiveDays,
      cooldownDays: row.cooldownDays,
      attributionDays: row.attributionDays,
      segmentId: row.segmentId,
      status: row.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      approval: this.guards.approvalDto(row),
      lastError: row.lastError,
      stats: stats ?? { pending: 0, sent: 0, skipped: 0, failed: 0, cancelled: 0, conversions: 0, revenueMinor: 0 },
      createdAt: row.createdAt.toISOString(),
    };
  }
}
