import { Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { PartnerCodeSchema, UpdatePartnerReferralConfigSchema } from '@resget/shared';
import type {
  AdminPartnerReferralDTO,
  MyPartnerReferralsDTO,
  PartnerInviteDTO,
  PartnerReferralConfigDTO,
  UpdatePartnerReferralConfigInput,
} from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { PartnerReferralsService } from './partner-referrals.service';

/** A restaurant's partner code and the restaurants it brought in (docs/RESTORAN_TAVSIYE.md). */
@Controller('restaurants/:restaurantId/partner-referrals')
@RestaurantScoped()
@RequireFeature('partner_referrals')
export class PartnerReferralsController {
  constructor(private readonly referrals: PartnerReferralsService) {}

  @Get()
  @RequirePermission('subscription.manage')
  mine(@Tenant() tenant: TenantContext): Promise<MyPartnerReferralsDTO> {
    return this.referrals.mine(tenant.restaurantId);
  }

  @Post('code')
  @HttpCode(200)
  @RequirePermission('subscription.manage')
  code(@Tenant() tenant: TenantContext): Promise<MyPartnerReferralsDTO> {
    return this.referrals.codeFor(tenant.restaurantId);
  }
}

/** The invite banner on the sign-up page; rate limited so codes cannot be swept. */
@Controller('public/partner-invites')
@UseGuards(PublicRateLimitGuard)
@RateLimit({ bucket: 'invite', limit: 30, windowSeconds: 600 })
export class PartnerInvitesController {
  constructor(private readonly referrals: PartnerReferralsService) {}

  @Get(':code')
  invite(@ZodParam('code', PartnerCodeSchema) code: string): Promise<PartnerInviteDTO> {
    return this.referrals.invite(code);
  }
}

/** The platform owner sets the rewards and sees every referral (docs/RESTORAN_TAVSIYE.md). */
@Controller('admin/partner-referrals')
@SuperAdminOnly()
export class AdminPartnerReferralsController {
  constructor(private readonly referrals: PartnerReferralsService) {}

  @Get('config')
  config(): Promise<PartnerReferralConfigDTO> {
    return this.referrals.config();
  }

  @Put('config')
  update(
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdatePartnerReferralConfigSchema) body: UpdatePartnerReferralConfigInput,
  ): Promise<PartnerReferralConfigDTO> {
    return this.referrals.updateConfig(user.id, body);
  }

  @Get()
  list(): Promise<AdminPartnerReferralDTO[]> {
    return this.referrals.adminList();
  }
}
