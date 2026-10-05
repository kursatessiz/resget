import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  AdminReviewsQuerySchema,
  ReportReviewSchema,
  ReviewDecisionSchema,
  ReviewReplySchema,
  ReviewsQuerySchema,
  SlugSchema,
  UuidSchema,
} from '@resget/shared';
import type {
  AdminReviewDTO,
  AdminReviewsQuery,
  PanelReviewDTO,
  PanelReviewsPageDTO,
  PublicReviewsPageDTO,
  ReportReviewInput,
  ReviewDecisionInput,
  ReviewReplyInput,
  ReviewsQuery,
} from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ReviewsService } from './reviews.service';

/** The restaurant's reviews: read, answer, report (docs/YORUMLAR.md). */
@Controller('restaurants/:restaurantId/reviews')
@RestaurantScoped()
@RequireFeature('public_reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @RequirePermission('customers.view')
  list(
    @Tenant() tenant: TenantContext,
    @ZodQuery(ReviewsQuerySchema) query: ReviewsQuery,
  ): Promise<PanelReviewsPageDTO> {
    return this.reviews.panelPage(tenant.restaurantId, query.cursor);
  }

  @Put(':ratingId/reply')
  @RequirePermission('customers.manage')
  reply(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('ratingId', UuidSchema) ratingId: string,
    @ZodBody(ReviewReplySchema) body: ReviewReplyInput,
  ): Promise<PanelReviewDTO> {
    return this.reviews.reply(tenant.restaurantId, ratingId, body.body, user.id);
  }

  @Post(':ratingId/report')
  @HttpCode(200)
  @RequirePermission('customers.manage')
  report(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('ratingId', UuidSchema) ratingId: string,
    @ZodBody(ReportReviewSchema) body: ReportReviewInput,
  ): Promise<PanelReviewDTO> {
    return this.reviews.report(tenant.restaurantId, ratingId, body, user.id);
  }
}

/** Every review the restaurant page shows, newest first. */
@Controller('public/restaurants/:slug/reviews')
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(
    @ZodParam('slug', SlugSchema) slug: string,
    @ZodQuery(ReviewsQuerySchema) query: ReviewsQuery,
  ): Promise<PublicReviewsPageDTO> {
    return this.reviews.publicPage(slug, query.cursor);
  }
}

/** Platform owner: reported and taken down reviews. */
@Controller('admin/reviews')
@SuperAdminOnly()
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@ZodQuery(AdminReviewsQuerySchema) query: AdminReviewsQuery): Promise<AdminReviewDTO[]> {
    return this.reviews.adminList(query);
  }

  @Post(':id/decision')
  @HttpCode(200)
  decide(
    @CurrentUser() user: AuthUser,
    @ZodParam('id', UuidSchema) id: string,
    @ZodBody(ReviewDecisionSchema) body: ReviewDecisionInput,
  ): Promise<AdminReviewDTO> {
    return this.reviews.decide(id, body, user.id);
  }
}
