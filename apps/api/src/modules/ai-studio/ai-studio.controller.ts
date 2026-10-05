import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  CampaignDraftRequestSchema,
  MenuDescriptionRequestSchema,
  UpdateAiBudgetSchema,
  UuidSchema,
} from '@resget/shared';
import type {
  AiBudgetDTO,
  AiDraftResultDTO,
  CampaignDraftRequest,
  MenuDescriptionRequest,
  UpdateAiBudgetInput,
} from '@resget/shared';
import { notFound } from '../../common/api-error';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { AiStudioService } from './ai-studio.service';

/** AI studio drafts (docs/YAPAY_ZEKA.md); PRO, behind the ai_studio module. */
@Controller('restaurants/:restaurantId/ai')
@RestaurantScoped()
@RequireFeature('ai_studio')
@RequirePlanFeature('campaigns')
export class AiStudioController {
  constructor(private readonly ai: AiStudioService) {}

  @Get('budget')
  @RequirePermission('campaigns.view')
  budget(@Tenant() tenant: TenantContext): Promise<AiBudgetDTO> {
    return this.ai.budget(tenant.restaurantId);
  }

  @Post('campaign-drafts')
  @HttpCode(200)
  @RequirePermission('campaigns.manage')
  campaignDrafts(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CampaignDraftRequestSchema) body: CampaignDraftRequest,
  ): Promise<AiDraftResultDTO> {
    return this.ai.campaignDrafts(tenant.restaurantId, user.id, body);
  }

  @Post('menu-descriptions')
  @HttpCode(200)
  @RequirePermission('menu.manage')
  menuDescription(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(MenuDescriptionRequestSchema) body: MenuDescriptionRequest,
  ): Promise<AiDraftResultDTO> {
    return this.ai.menuDescription(tenant.restaurantId, user.id, body);
  }
}

/** A tenant's monthly AI budget, set by the platform owner. */
@Controller('admin/ai-budgets')
@SuperAdminOnly()
export class AdminAiBudgetsController {
  constructor(
    private readonly ai: AiStudioService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':restaurantId')
  async get(@ZodParam('restaurantId', UuidSchema) restaurantId: string): Promise<AiBudgetDTO> {
    await this.requireRestaurant(restaurantId);
    return this.ai.budget(restaurantId);
  }

  @Put(':restaurantId')
  async set(
    @CurrentUser() user: AuthUser,
    @ZodParam('restaurantId', UuidSchema) restaurantId: string,
    @ZodBody(UpdateAiBudgetSchema) body: UpdateAiBudgetInput,
  ): Promise<AiBudgetDTO> {
    await this.requireRestaurant(restaurantId);
    return this.ai.setBudget(restaurantId, user.id, body);
  }

  private async requireRestaurant(id: string): Promise<void> {
    const found = await this.prisma.restaurant.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
  }
}
