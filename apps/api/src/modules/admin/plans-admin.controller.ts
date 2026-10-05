import { Controller, Delete, Get, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import {
  AssignPlanSchema,
  CreateEntitlementExceptionSchema,
  CreatePlanSchema,
  SetPlanFeaturesSchema,
  UpdatePlanSchema,
  UuidSchema,
} from '@resget/shared';
import type { PlanDTO, PlanFeaturesChangeDTO, RestaurantEntitlementsDTO } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { PlansAdminService } from './plans-admin.service';

/** Platform owner only: plans as data, the plan matrix and per-restaurant exceptions (docs/PLAN_MATRISI.md). */
@Controller('admin')
@SuperAdminOnly()
export class PlansAdminController {
  constructor(private readonly plans: PlansAdminService) {}

  @Get('plans')
  list(): Promise<PlanDTO[]> {
    return this.plans.list();
  }

  @Post('plans')
  create(
    @CurrentUser() user: AuthUser,
    @ZodBody(CreatePlanSchema) body: z.infer<typeof CreatePlanSchema>,
  ): Promise<PlanDTO> {
    return this.plans.create(user.id, body);
  }

  @Patch('plans/:id')
  update(
    @CurrentUser() user: AuthUser,
    @ZodParam('id', UuidSchema) id: string,
    @ZodBody(UpdatePlanSchema) body: z.infer<typeof UpdatePlanSchema>,
  ): Promise<PlanDTO> {
    return this.plans.update(user.id, id, body);
  }

  @Put('plans/:id/features')
  setFeatures(
    @CurrentUser() user: AuthUser,
    @ZodParam('id', UuidSchema) id: string,
    @ZodBody(SetPlanFeaturesSchema) body: z.infer<typeof SetPlanFeaturesSchema>,
  ): Promise<PlanFeaturesChangeDTO> {
    return this.plans.setFeatures(user.id, id, body.features);
  }

  @Get('restaurants/:restaurantId/entitlements')
  entitlements(@ZodParam('restaurantId', UuidSchema) restaurantId: string): Promise<RestaurantEntitlementsDTO> {
    return this.plans.restaurantEntitlements(restaurantId);
  }

  @Put('restaurants/:restaurantId/plan')
  assignPlan(
    @CurrentUser() user: AuthUser,
    @ZodParam('restaurantId', UuidSchema) restaurantId: string,
    @ZodBody(AssignPlanSchema) body: z.infer<typeof AssignPlanSchema>,
  ): Promise<RestaurantEntitlementsDTO> {
    return this.plans.assignPlan(user.id, restaurantId, body);
  }

  @Post('restaurants/:restaurantId/entitlements')
  grant(
    @CurrentUser() user: AuthUser,
    @ZodParam('restaurantId', UuidSchema) restaurantId: string,
    @ZodBody(CreateEntitlementExceptionSchema) body: z.infer<typeof CreateEntitlementExceptionSchema>,
  ): Promise<RestaurantEntitlementsDTO> {
    return this.plans.grantException(user.id, restaurantId, body);
  }

  @Delete('restaurants/:restaurantId/entitlements/:grantId')
  revoke(
    @CurrentUser() user: AuthUser,
    @ZodParam('restaurantId', UuidSchema) restaurantId: string,
    @ZodParam('grantId', UuidSchema) grantId: string,
  ): Promise<RestaurantEntitlementsDTO> {
    return this.plans.revoke(user.id, restaurantId, grantId);
  }
}
