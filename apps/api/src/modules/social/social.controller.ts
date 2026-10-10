import { Controller, Delete, Get, HttpCode, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  CompleteMetaConnectSchema,
  StartMetaConnectSchema,
  UpdateSocialAccountSchema,
  UuidSchema,
} from '@resget/shared';
import type {
  CompleteMetaConnectInput,
  OAuthCompleteDTO,
  OAuthStartDTO,
  SocialAccountDTO,
  StartMetaConnectInput,
  UpdateSocialAccountInput,
} from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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

/**
 * The end of the consent round trip (docs/ENTEGRASYON_MERKEZI.md). Meta sends the browser to the web app's
 * callback route, which posts the query here with that browser's session: only the person who started the
 * round trip can finish it. A session is required; an API key cannot finish a consent.
 */
@Controller('oauth')
@UseGuards(PublicRateLimitGuard, JwtAuthGuard)
export class OAuthCompleteController {
  constructor(private readonly social: SocialService) {}

  @Post('meta/callback')
  @HttpCode(200)
  @RateLimit({ bucket: 'oauth', limit: 30, windowSeconds: 600 })
  completeMeta(
    @CurrentUser() user: AuthUser,
    @ZodBody(CompleteMetaConnectSchema) body: CompleteMetaConnectInput,
  ): Promise<OAuthCompleteDTO> {
    return this.social.completeMeta(user.id, body);
  }
}

/**
 * The redirect address of earlier releases. It finishes nothing any more (a browser without the starter's
 * session could complete a forwarded consent here); it answers with the error screen for one release and
 * can then be removed.
 */
@Controller('public/oauth')
@UseGuards(PublicRateLimitGuard)
export class OAuthCallbackController {
  constructor(private readonly social: SocialService) {}

  @Get('meta/callback')
  @RateLimit({ bucket: 'oauth', limit: 30, windowSeconds: 600 })
  metaCallback(@Res() res: Response): void {
    res.redirect(302, this.social.legacyCallbackRedirect());
  }
}
