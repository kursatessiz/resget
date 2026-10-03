import { Controller, Get, HttpCode, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { HostnameSchema, SetCustomDomainSchema } from '@resget/shared';
import type { CustomDomainDTO, PublicDomainResolveDTO } from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { notFound } from '../../common/api-error';
import {
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { DomainsService } from './domains.service';

/** The restaurant's custom domain (docs/VITRIN.md): reading is open so BASIC sees the rule, writing is PRO. */
@Controller('restaurants/:restaurantId/domain')
@RestaurantScoped()
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  @RequirePermission('restaurant.settings.view')
  status(@Tenant() tenant: TenantContext): Promise<CustomDomainDTO> {
    return this.domains.status(tenant.restaurantId);
  }

  @Put()
  @RequirePermission('restaurant.settings.manage')
  @RequirePlanFeature('custom_domain')
  set(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(SetCustomDomainSchema) body: z.infer<typeof SetCustomDomainSchema>,
  ): Promise<CustomDomainDTO> {
    return this.domains.set(tenant.restaurantId, body.domain, user.id);
  }

  @Post('verify')
  @HttpCode(200)
  @RequirePermission('restaurant.settings.manage')
  @RequirePlanFeature('custom_domain')
  verify(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser): Promise<CustomDomainDTO> {
    return this.domains.verify(tenant.restaurantId, user.id);
  }
}

/**
 * Host lookups for the edge: the web middleware asks which page a host
 * serves, and Caddy's on-demand TLS asks whether it may issue a certificate
 * for a host at all (deploy/caddy/Caddyfile). Unknown hosts are 404 so no
 * certificate is ever requested for a name that is not ours to serve.
 */
@Controller('public/domains')
export class PublicDomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get('resolve')
  async resolve(@Query('host') host?: string): Promise<PublicDomainResolveDTO> {
    const slug = await this.lookup(host);
    if (!slug) throw notFound('NOT_FOUND', 'Unknown host');
    return { slug };
  }

  @Get('check')
  async check(@Query('domain') domain: string | undefined, @Res() res: Response): Promise<void> {
    const slug = await this.lookup(domain);
    res.status(slug ? 200 : 404).end();
  }

  private async lookup(host: string | undefined): Promise<string | null> {
    const parsed = HostnameSchema.safeParse(host?.split(':')[0] ?? '');
    if (!parsed.success) return null;
    return this.domains.resolve(parsed.data);
  }
}
