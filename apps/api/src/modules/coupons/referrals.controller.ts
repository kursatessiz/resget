import { Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { UpsertReferralProgramSchema, UuidSchema } from '@resget/shared';
import type { MyReferralDTO, ReferralProgramDTO, UpsertReferralProgramInput } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ReferralsService } from './referrals.service';

/** The restaurant's customer referral programme (docs/TAVSIYE.md); PRO, built on coupons. */
@Controller('restaurants/:restaurantId/referrals')
@RestaurantScoped()
@RequireFeature('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('program')
  @RequirePermission('campaigns.view')
  async program(@Tenant() tenant: TenantContext): Promise<{ program: ReferralProgramDTO | null }> {
    return { program: await this.referrals.program(tenant.restaurantId) };
  }

  @Put('program')
  @RequirePermission('campaigns.manage')
  @RequirePlanFeature('coupons')
  upsert(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpsertReferralProgramSchema) body: UpsertReferralProgramInput,
  ): Promise<ReferralProgramDTO> {
    return this.referrals.upsert(tenant.restaurantId, user.id, body);
  }
}

/** A signed-in customer's personal codes and rewards across restaurants (docs/TAVSIYE.md). */
@Controller('me/referrals')
@UseGuards(JwtAuthGuard)
export class MyReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser): Promise<MyReferralDTO[]> {
    return this.referrals.mine(user.id);
  }

  @Post(':restaurantId/code')
  @HttpCode(200)
  code(
    @CurrentUser() user: AuthUser,
    @ZodParam('restaurantId', UuidSchema) restaurantId: string,
  ): Promise<MyReferralDTO> {
    return this.referrals.codeFor(user.id, restaurantId);
  }
}
