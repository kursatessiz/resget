import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { CreateJourneySchema, RejectCampaignSchema, UpdateJourneySchema, UuidSchema } from '@resget/shared';
import type {
  CreateJourneyInput,
  JourneyDTO,
  JourneyListDTO,
  RejectCampaignInput,
  UpdateJourneyInput,
} from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { JourneysService } from './journeys.service';

/** Automated flows (docs/AKISLAR.md); part of PRO campaigns. */
@Controller('restaurants/:restaurantId/journeys')
@RestaurantScoped()
@RequireFeature('journeys')
@RequirePlanFeature('campaigns')
export class JourneysController {
  constructor(private readonly journeys: JourneysService) {}

  @Get()
  @RequirePermission('campaigns.view')
  list(@Tenant() tenant: TenantContext): Promise<JourneyListDTO> {
    return this.journeys.list(tenant.restaurantId);
  }

  @Post()
  @RequirePermission('campaigns.manage')
  create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateJourneySchema) body: CreateJourneyInput,
  ): Promise<JourneyDTO> {
    return this.journeys.create(tenant.restaurantId, user.id, body);
  }

  @Patch(':journeyId')
  @RequirePermission('campaigns.manage')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('journeyId', UuidSchema) journeyId: string,
    @ZodBody(UpdateJourneySchema) body: UpdateJourneyInput,
  ): Promise<JourneyDTO> {
    return this.journeys.update(tenant.restaurantId, journeyId, user.id, body);
  }

  @Delete(':journeyId')
  @HttpCode(204)
  @RequirePermission('campaigns.manage')
  async remove(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('journeyId', UuidSchema) journeyId: string,
  ): Promise<void> {
    await this.journeys.remove(tenant.restaurantId, journeyId, user.id);
  }

  /** Send approvals (docs/ONAYLAR.md): the marketing_approvals module must be on. */
  @Post(':journeyId/approval/approve')
  @HttpCode(200)
  @RequirePermission('campaigns.approve')
  approve(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('journeyId', UuidSchema) journeyId: string,
  ): Promise<JourneyDTO> {
    return this.journeys.decideApproval(tenant.restaurantId, journeyId, user.id, { approve: true });
  }

  @Post(':journeyId/approval/reject')
  @HttpCode(200)
  @RequirePermission('campaigns.approve')
  reject(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('journeyId', UuidSchema) journeyId: string,
    @ZodBody(RejectCampaignSchema) body: RejectCampaignInput,
  ): Promise<JourneyDTO> {
    return this.journeys.decideApproval(tenant.restaurantId, journeyId, user.id, { approve: false, note: body.note });
  }
}
