import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import {
  REVIEW_PAGE_SIZE,
  editableUntil,
  orderShortCode,
  ratingSummary,
  reviewAuthorName,
  scrubReviewText,
  withinEditWindow,
} from '@resget/shared';
import type {
  AdminReviewDTO,
  AdminReviewsQuery,
  PanelReviewDTO,
  PanelReviewsPageDTO,
  PublicReviewDTO,
  PublicReviewsPageDTO,
  ReportReviewInput,
  ReviewDecisionInput,
  ReviewReportReason,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { conflict, notFound } from '../../common/api-error';

const reviewSelect = {
  id: true,
  restaurantId: true,
  orderId: true,
  score: true,
  comment: true,
  createdAt: true,
  editedAt: true,
  reply: true,
  replyCreatedAt: true,
  replyEditedAt: true,
  reportReason: true,
  reportNote: true,
  reportedAt: true,
  reportResolvedAt: true,
  hiddenAt: true,
  hiddenReason: true,
  order: { select: { customer: { select: { fullName: true } } } },
  restaurant: { select: { id: true, name: true, slug: true, defaultLocale: true } },
} satisfies Prisma.OrderRatingSelect;
type ReviewRow = Prisma.OrderRatingGetPayload<{ select: typeof reviewSelect }>;

/**
 * Public reviews (docs/YORUMLAR.md): the restaurant page lists every review
 * that is not taken down, signed with a short name and with personal data
 * masked; the restaurant answers and reports; the platform owner hides,
 * restores or dismisses. Taking a review down removes its score from the
 * restaurant's average, putting it back adds it again.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
  ) {}

  // -- Public ----------------------------------------------------------------------

  async publicPage(slug: string, cursor?: string): Promise<PublicReviewsPageDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true, isActive: true, isPlatform: true, ratingSum: true, ratingCount: true },
    });
    if (!restaurant || !restaurant.isActive || restaurant.isPlatform)
      throw notFound('NOT_FOUND', 'Restaurant not found');
    if (!(await this.features.isEnabled('public_reviews', restaurant.id)))
      throw notFound('NOT_FOUND', 'Reviews are not shown here');
    const { rows, nextCursor } = await this.page({ restaurantId: restaurant.id, hiddenAt: null }, cursor);
    return {
      summary: ratingSummary(restaurant.ratingSum, restaurant.ratingCount),
      items: rows.map((row) => this.toPublic(row)),
      nextCursor,
    };
  }

  // -- Panel -----------------------------------------------------------------------

  async panelPage(restaurantId: string, cursor?: string): Promise<PanelReviewsPageDTO> {
    const { rows, nextCursor } = await this.page({ restaurantId }, cursor);
    return { items: rows.map((row) => this.toPanel(row)), nextCursor };
  }

  /** The restaurant's public answer: written once, then editable for a day. */
  async reply(restaurantId: string, ratingId: string, body: string, actorUserId: string): Promise<PanelReviewDTO> {
    const row = await this.find(restaurantId, ratingId);
    const now = new Date();
    if (row.reply === null || row.replyCreatedAt === null) {
      await this.prisma.orderRating.update({
        where: { id: row.id },
        data: { reply: body, replyCreatedAt: now, replyByUserId: actorUserId },
      });
    } else {
      if (!withinEditWindow(row.replyCreatedAt, now)) throw conflict('REVIEW_EDIT_CLOSED', 'The time to edit is over');
      await this.prisma.orderRating.update({
        where: { id: row.id },
        data: { reply: body, replyEditedAt: now, replyByUserId: actorUserId },
      });
    }
    return this.toPanel(await this.find(restaurantId, ratingId));
  }

  /** A review the restaurant thinks breaks the rules goes to the platform once. */
  async report(
    restaurantId: string,
    ratingId: string,
    input: ReportReviewInput,
    actorUserId: string,
  ): Promise<PanelReviewDTO> {
    const row = await this.find(restaurantId, ratingId);
    const updated = await this.prisma.orderRating.updateMany({
      where: { id: row.id, reportedAt: null },
      data: {
        reportReason: input.reason,
        reportNote: input.note,
        reportedAt: new Date(),
        reportedByUserId: actorUserId,
      },
    });
    if (updated.count === 0) throw conflict('REVIEW_ALREADY_REPORTED', 'This review was already reported');
    return this.toPanel(await this.find(restaurantId, ratingId));
  }

  // -- Console ---------------------------------------------------------------------

  async adminList(query: AdminReviewsQuery): Promise<AdminReviewDTO[]> {
    const where: Prisma.OrderRatingWhereInput =
      query.status === 'HIDDEN'
        ? { hiddenAt: { not: null } }
        : { reportedAt: { not: null }, reportResolvedAt: null, hiddenAt: null };
    const rows = await this.prisma.orderRating.findMany({
      where,
      orderBy: query.status === 'HIDDEN' ? { hiddenAt: 'desc' } : { reportedAt: 'asc' },
      take: 100,
      select: reviewSelect,
    });
    return rows.map((row) => this.toAdmin(row));
  }

  async decide(id: string, input: ReviewDecisionInput, actorUserId: string): Promise<AdminReviewDTO> {
    const row = await this.prisma.orderRating.findUnique({ where: { id }, select: reviewSelect });
    if (!row) throw notFound('REVIEW_NOT_FOUND', 'Review not found');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (input.action === 'HIDE' && !row.hiddenAt) {
        await tx.orderRating.update({
          where: { id },
          data: {
            hiddenAt: now,
            hiddenReason: input.note,
            hiddenByUserId: actorUserId,
            ...(row.reportedAt && !row.reportResolvedAt ? { reportResolvedAt: now } : {}),
          },
        });
        await tx.restaurant.update({
          where: { id: row.restaurantId },
          data: { ratingSum: { decrement: row.score }, ratingCount: { decrement: 1 } },
        });
      } else if (input.action === 'RESTORE' && row.hiddenAt) {
        await tx.orderRating.update({
          where: { id },
          data: { hiddenAt: null, hiddenReason: null, hiddenByUserId: null },
        });
        await tx.restaurant.update({
          where: { id: row.restaurantId },
          data: { ratingSum: { increment: row.score }, ratingCount: { increment: 1 } },
        });
      } else if (input.action === 'DISMISS' && row.reportedAt && !row.reportResolvedAt) {
        await tx.orderRating.update({ where: { id }, data: { reportResolvedAt: now } });
      } else {
        throw conflict('VALIDATION', `Nothing to ${input.action.toLowerCase()} on this review`);
      }
      await tx.auditLog.create({
        data: {
          actorUserId,
          restaurantId: row.restaurantId,
          action: `review.${input.action.toLowerCase()}`,
          entity: 'order_rating',
          entityId: id,
          meta: { note: input.note, reportReason: row.reportReason },
        },
      });
    });
    const fresh = await this.prisma.orderRating.findUniqueOrThrow({ where: { id }, select: reviewSelect });
    return this.toAdmin(fresh);
  }

  // -- Helpers ---------------------------------------------------------------------

  private async find(restaurantId: string, ratingId: string): Promise<ReviewRow> {
    const row = await this.prisma.orderRating.findFirst({
      where: { id: ratingId, restaurantId },
      select: reviewSelect,
    });
    if (!row) throw notFound('REVIEW_NOT_FOUND', 'Review not found');
    return row;
  }

  /** Newest first, keyset paged by id within the same timestamp. */
  private async page(
    where: Prisma.OrderRatingWhereInput,
    cursor?: string,
  ): Promise<{ rows: ReviewRow[]; nextCursor: string | null }> {
    const rows = await this.prisma.orderRating.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: REVIEW_PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: reviewSelect,
    });
    const more = rows.length > REVIEW_PAGE_SIZE;
    const page = more ? rows.slice(0, REVIEW_PAGE_SIZE) : rows;
    return { rows: page, nextCursor: more ? page[page.length - 1].id : null };
  }

  private toPublic(row: ReviewRow): PublicReviewDTO {
    return {
      id: row.id,
      score: row.score,
      comment: row.comment ? scrubReviewText(row.comment) : null,
      author: reviewAuthorName(row.order.customer?.fullName, row.restaurant.defaultLocale),
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
      reply:
        row.reply && row.replyCreatedAt
          ? {
              body: row.reply,
              createdAt: row.replyCreatedAt.toISOString(),
              editedAt: row.replyEditedAt?.toISOString() ?? null,
            }
          : null,
    };
  }

  private toPanel(row: ReviewRow, now: Date = new Date()): PanelReviewDTO {
    return {
      ...this.toPublic(row),
      // The restaurant reads the review as written; only the public page masks it.
      comment: row.comment,
      orderShortCode: orderShortCode(row.orderId),
      replyEditableUntil: row.replyCreatedAt ? editableUntil(row.replyCreatedAt).toISOString() : null,
      canReply: row.replyCreatedAt === null || withinEditWindow(row.replyCreatedAt, now),
      report:
        row.reportedAt && row.reportReason
          ? {
              reason: row.reportReason as ReviewReportReason,
              note: row.reportNote,
              reportedAt: row.reportedAt.toISOString(),
              resolvedAt: row.reportResolvedAt?.toISOString() ?? null,
            }
          : null,
      hiddenAt: row.hiddenAt?.toISOString() ?? null,
    };
  }

  private toAdmin(row: ReviewRow): AdminReviewDTO {
    return {
      ...this.toPanel(row),
      restaurant: { id: row.restaurant.id, name: row.restaurant.name, slug: row.restaurant.slug },
      hiddenReason: row.hiddenReason,
    };
  }
}
