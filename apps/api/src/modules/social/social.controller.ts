import { Controller, Delete, Get, HttpCode, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { StartMetaConnectSchema, UpdateSocialAccountSchema, UuidSchema } from '@resget/shared';
import type { OAuthStartDTO, SocialAccountDTO, StartMetaConnectInput, UpdateSocialAccountInput } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { SocialService } from './social.service';

/** Social accounts of a tenant (docs/ENTEGRASYON_MERKEZI.md). */
@Controller('restaurants/:restaurantId/social')
@RestaurantScoped()
@RequireFeature('integration_hub')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Post('meta/connect')
  @HttpCode(200)
  @RequirePermission('integrations.manage')
  connect(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(StartMetaConnectSchema) body: StartMetaConnectInput,
  ): Promise<OAuthStartDTO> {
    return this.social.startMeta(tenant.restaurantId, user.id, body.returnPath);
  }

  @Get('accounts')
  @RequirePermission('integrations.manage')
  accounts(@Tenant() tenant: TenantContext): Promise<SocialAccountDTO[]> {
    return this.social.list(tenant.restaurantId);
  }

  @Patch('accounts/:accountId')
  @RequirePermission('integrations.manage')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('accountId', UuidSchema) accountId: string,
    @ZodBody(UpdateSocialAccountSchema) body: UpdateSocialAccountInput,
  ): Promise<SocialAccountDTO> {
    return this.social.update(tenant.restaurantId, accountId, user.id, body);
  }

  @Delete('accounts/:accountId')
  @HttpCode(204)
  @RequirePermission('integrations.manage')
  remove(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('accountId', UuidSchema) accountId: string,
  ): Promise<void> {
    return this.social.remove(tenant.restaurantId, accountId, user.id);
  }
}

/** Where Meta sends the browser back after consent; public, rate limited, and always answers with a redirect. */
@Controller('public/oauth')
@UseGuards(PublicRateLimitGuard)
export class OAuthCallbackController {
  constructor(private readonly social: SocialService) {}

  @Get('meta/callback')
  @RateLimit({ bucket: 'oauth', limit: 30, windowSeconds: 600 })
  async metaCallback(@Query() query: Record<string, unknown>, @Res() res: Response): Promise<void> {
    // A repeated parameter arrives as an array; only single string values are read, anything else counts as absent.
    const outcome = await this.social.metaCallback({
      code: single(query.code),
      state: single(query.state),
      error: single(query.error),
    });
    res.redirect(302, outcome.redirectUrl);
  }
}

function single(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
