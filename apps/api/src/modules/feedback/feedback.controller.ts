import { Controller, Get, Patch, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  FEEDBACK_CASE_STATUSES,
  FEEDBACK_REPORT_RANGE_DAYS,
  UpdateFeedbackCaseSchema,
  UpdateFeedbackSettingsSchema,
  UuidSchema,
} from '@resget/shared';
import type {
  FeedbackCaseDTO,
  FeedbackOverviewDTO,
  FeedbackSettingsDTO,
  UpdateFeedbackCaseInput,
  UpdateFeedbackSettingsInput,
} from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { FeedbackService } from './feedback.service';

const CasesQuerySchema = z.object({ status: z.enum(FEEDBACK_CASE_STATUSES).optional() }).strict();
const OverviewQuerySchema = z
  .object({
    days: z.coerce
      .number()
      .int()
      .refine((d) => (FEEDBACK_REPORT_RANGE_DAYS as readonly number[]).includes(d), { message: 'unsupported range' })
      .default(90),
  })
  .strict();

/** Feedback routing and NPS (docs/GERI_BILDIRIM.md); PRO analytics. */
@Controller('restaurants/:restaurantId/feedback')
@RestaurantScoped()
@RequireFeature('feedback')
@RequirePlanFeature('analytics')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('settings')
  @RequirePermission('customers.view')
  settings(@Tenant() tenant: TenantContext): Promise<FeedbackSettingsDTO> {
    return this.feedback.settings(tenant.restaurantId);
  }

  @Put('settings')
  @RequirePermission('restaurant.settings.manage')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateFeedbackSettingsSchema) body: UpdateFeedbackSettingsInput,
  ): Promise<FeedbackSettingsDTO> {
    return this.feedback.updateSettings(tenant.restaurantId, user.id, body);
  }

  @Get('overview')
  @RequirePermission('reports.view')
  overview(
    @Tenant() tenant: TenantContext,
    @ZodQuery(OverviewQuerySchema) query: z.infer<typeof OverviewQuerySchema>,
  ): Promise<FeedbackOverviewDTO> {
    return this.feedback.overview(tenant.restaurantId, query.days);
  }

  @Get('cases')
  @RequirePermission('customers.view')
  cases(
    @Tenant() tenant: TenantContext,
    @ZodQuery(CasesQuerySchema) query: z.infer<typeof CasesQuerySchema>,
  ): Promise<FeedbackCaseDTO[]> {
    return this.feedback.cases(tenant.restaurantId, query.status, tenant.permissions.has('customers.contact.view'));
  }

  @Patch('cases/:caseId')
  @RequirePermission('customers.manage')
  updateCase(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('caseId', UuidSchema) caseId: string,
    @ZodBody(UpdateFeedbackCaseSchema) body: UpdateFeedbackCaseInput,
  ): Promise<FeedbackCaseDTO> {
    return this.feedback.updateCase(
      tenant.restaurantId,
      caseId,
      user.id,
      body,
      tenant.permissions.has('customers.contact.view'),
    );
  }
}
