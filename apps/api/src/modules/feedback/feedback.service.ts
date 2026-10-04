import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import {
  RATING_MAX,
  RATING_MIN,
  canRateOrder,
  hasFeature,
  isLowRating,
  npsCategory,
  npsScore,
  orderShortCode,
  visibleContact,
} from '@resget/shared';
import type {
  FeedbackCaseDTO,
  FeedbackCaseStatus,
  FeedbackOverviewDTO,
  FeedbackSettingsDTO,
  NpsAnswerInput,
  OrderStatusValue,
  PlanCode,
  SubscriptionStatus as SharedSubscriptionStatus,
  UpdateFeedbackCaseInput,
  UpdateFeedbackSettingsInput,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { conflict, notFound } from '../../common/api-error';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULTS: UpdateFeedbackSettingsInput = { reviewUrl: null, alertMaxScore: 2, npsEnabled: false };

/** The parts of an order the tracking page's feedback block reads. */
export interface FeedbackOrderView {
  id: string;
  restaurantId: string;
  status: OrderStatusValue;
  completedAt: Date | null;
  rating: { score: number } | null;
  npsResponse: { score: number } | null;
}

/**
 * Feedback routing and NPS (docs/GERI_BILDIRIM.md): low ratings become
 * cases for the staff, the review page is offered to every rater alike, and
 * NPS is asked once on the tracking page. Active while the feedback module
 * is on and the plan carries analytics (PRO).
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly push: PushService,
  ) {}

  // -- Settings ------------------------------------------------------------------------

  async settings(restaurantId: string): Promise<FeedbackSettingsDTO> {
    const row = await this.prisma.feedbackSettings.findUnique({ where: { restaurantId } });
    return row
      ? {
          reviewUrl: row.reviewUrl,
          alertMaxScore: row.alertMaxScore,
          npsEnabled: row.npsEnabled,
          updatedAt: row.updatedAt.toISOString(),
        }
      : { ...DEFAULTS, updatedAt: null };
  }

  async updateSettings(
    restaurantId: string,
    actorUserId: string,
    input: UpdateFeedbackSettingsInput,
  ): Promise<FeedbackSettingsDTO> {
    await this.prisma.feedbackSettings.upsert({
      where: { restaurantId },
      create: { restaurantId, ...input },
      update: input,
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        restaurantId,
        action: 'feedback.settings',
        entity: 'FeedbackSettings',
        entityId: restaurantId,
        meta: { alertMaxScore: input.alertMaxScore, npsEnabled: input.npsEnabled, reviewUrl: input.reviewUrl },
      },
    });
    return this.settings(restaurantId);
  }

  // -- Ratings and NPS -----------------------------------------------------------------

  /** A new rating: at or below the threshold it opens a case and wakes the staff who follow customers. */
  async onRating(order: { id: string; restaurantId: string }, score: number, comment: string | null): Promise<void> {
    if (!(await this.active(order.restaurantId))) return;
    const settings = await this.settings(order.restaurantId);
    if (!isLowRating(score, settings.alertMaxScore)) return;
    const created = await this.prisma.feedbackCase
      .create({ data: { restaurantId: order.restaurantId, orderId: order.id, score, comment } })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
        throw err;
      });
    if (!created) return;
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: order.restaurantId },
      select: { name: true },
    });
    await this.push.notifyRestaurantStaff(
      order.restaurantId,
      'customers.view',
      'feedback.lowRating',
      { restaurant: restaurant?.name ?? '', code: orderShortCode(order.id), score },
      { kind: 'feedback' },
    );
  }

  /** What the tracking page shows after a rating: the review page for every rater, and the NPS question once. */
  async trackingExtras(
    order: FeedbackOrderView,
  ): Promise<{ reviewUrl: string | null; nps: { score: number } | null; canAnswerNps: boolean }> {
    const nps = order.npsResponse ? { score: order.npsResponse.score } : null;
    if (!(await this.active(order.restaurantId))) return { reviewUrl: null, nps, canAnswerNps: false };
    const settings = await this.settings(order.restaurantId);
    return {
      reviewUrl: order.rating ? settings.reviewUrl : null,
      nps,
      canAnswerNps: settings.npsEnabled && !order.npsResponse && canRateOrder(order.status, order.completedAt, false),
    };
  }

  async recordNps(order: FeedbackOrderView, input: NpsAnswerInput): Promise<void> {
    const extras = await this.trackingExtras(order);
    if (order.npsResponse) throw conflict('NPS_EXISTS', 'Already answered');
    if (!extras.canAnswerNps) throw conflict('NPS_NOT_ALLOWED', 'NPS cannot be answered for this order');
    try {
      await this.prisma.npsResponse.create({
        data: {
          restaurantId: order.restaurantId,
          orderId: order.id,
          score: input.score,
          comment: input.comment ?? null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('NPS_EXISTS', 'Already answered');
      }
      throw err;
    }
  }

  // -- Panel ---------------------------------------------------------------------------

  async cases(
    restaurantId: string,
    status: FeedbackCaseStatus | undefined,
    canSeeContacts: boolean,
  ): Promise<FeedbackCaseDTO[]> {
    const rows = await this.prisma.feedbackCase.findMany({
      where: { restaurantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { order: { select: { customer: { select: { fullName: true, phone: true } } } } },
    });
    return rows.map((row) => this.toCase(row, canSeeContacts));
  }

  async updateCase(
    restaurantId: string,
    caseId: string,
    actorUserId: string,
    input: UpdateFeedbackCaseInput,
    canSeeContacts: boolean,
  ): Promise<FeedbackCaseDTO> {
    const existing = await this.prisma.feedbackCase.findFirst({ where: { id: caseId, restaurantId } });
    if (!existing) throw notFound('FEEDBACK_CASE_NOT_FOUND', 'Case not found');
    const resolved = input.status === 'RESOLVED';
    const row = await this.prisma.feedbackCase.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        ...(input.note !== undefined ? { note: input.note } : {}),
        resolvedAt: resolved ? (existing.resolvedAt ?? new Date()) : null,
        resolvedByUserId: resolved ? (existing.resolvedByUserId ?? actorUserId) : null,
      },
      include: { order: { select: { customer: { select: { fullName: true, phone: true } } } } },
    });
    return this.toCase(row, canSeeContacts);
  }

  async overview(restaurantId: string, days: number, now: Date = new Date()): Promise<FeedbackOverviewDTO> {
    const since = new Date(now.getTime() - days * DAY_MS);
    const [ratings, answers, comments, openCases] = await Promise.all([
      this.prisma.orderRating.groupBy({
        by: ['score'],
        where: { restaurantId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.npsResponse.groupBy({
        by: ['score'],
        where: { restaurantId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.npsResponse.findMany({
        where: { restaurantId, createdAt: { gte: since }, comment: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { score: true, comment: true, createdAt: true },
      }),
      this.prisma.feedbackCase.count({ where: { restaurantId, status: 'OPEN' } }),
    ]);
    const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } as FeedbackOverviewDTO['ratings']['distribution'];
    let count = 0;
    let sum = 0;
    for (const r of ratings) {
      if (r.score < RATING_MIN || r.score > RATING_MAX) continue;
      distribution[String(r.score) as keyof typeof distribution] = r._count._all;
      count += r._count._all;
      sum += r.score * r._count._all;
    }
    const buckets = { promoters: 0, passives: 0, detractors: 0 };
    for (const a of answers) {
      const category = npsCategory(a.score);
      if (category === 'PROMOTER') buckets.promoters += a._count._all;
      else if (category === 'PASSIVE') buckets.passives += a._count._all;
      else buckets.detractors += a._count._all;
    }
    return {
      days,
      ratings: { count, average: count ? Math.round((sum / count) * 10) / 10 : null, distribution },
      nps: {
        score: npsScore(buckets),
        ...buckets,
        comments: comments.map((c) => ({
          score: c.score,
          comment: c.comment ?? '',
          createdAt: c.createdAt.toISOString(),
        })),
      },
      openCases,
    };
  }

  // -- Helpers -------------------------------------------------------------------------

  private async active(restaurantId: string): Promise<boolean> {
    if (!(await this.features.isEnabled('feedback', restaurantId))) return false;
    const row = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        subscription: {
          select: { plan: { select: { code: true } }, status: true, trialEndsAt: true, currentPeriodEnd: true },
        },
      },
    });
    const sub = row?.subscription;
    return hasFeature(
      sub
        ? {
            planCode: (sub.plan.code === 'PRO' ? 'PRO' : 'BASIC') as PlanCode,
            status: sub.status as unknown as SharedSubscriptionStatus,
            trialEndsAt: sub.trialEndsAt,
            currentPeriodEnd: sub.currentPeriodEnd,
          }
        : null,
      'analytics',
    );
  }

  private toCase(
    row: Prisma.FeedbackCaseGetPayload<{
      include: { order: { select: { customer: { select: { fullName: true; phone: true } } } } };
    }>,
    canSeeContacts: boolean,
  ): FeedbackCaseDTO {
    return {
      id: row.id,
      orderId: row.orderId,
      shortCode: orderShortCode(row.orderId),
      score: row.score,
      comment: row.comment,
      status: row.status as FeedbackCaseStatus,
      note: row.note,
      customer: canSeeContacts ? visibleContact(row.order.customer) : null,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }
}
