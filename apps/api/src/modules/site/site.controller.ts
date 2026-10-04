import { Controller, Delete, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  LocaleCodeSchema,
  SITE_PAGE_KINDS,
  SitePagePathSchema,
  SlugSchema,
  UpsertSitePageSchema,
  UuidSchema,
} from '@resget/shared';
import type {
  BlogIndexDTO,
  DistrictLandingDTO,
  LlmsDTO,
  PublicSitePageDTO,
  RestaurantSeoDTO,
  SitePageDTO,
  SitemapDTO,
  UpsertSitePageInput,
} from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { SiteService } from './site.service';

/** The platform's engine pages (docs/SAYFA_MOTORU.md); platform tenant only. */
@Controller('restaurants/:restaurantId/site/pages')
@RestaurantScoped()
@RequireFeature('page_engine')
export class SitePagesController {
  constructor(private readonly site: SiteService) {}

  @Get()
  @RequirePermission('campaigns.view')
  list(@Tenant() tenant: TenantContext): Promise<SitePageDTO[]> {
    return this.site.list(tenant.restaurantId);
  }

  @Post()
  @RequirePermission('campaigns.manage')
  create(
    @Tenant() tenant: TenantContext,
    @ZodBody(UpsertSitePageSchema) body: UpsertSitePageInput,
  ): Promise<SitePageDTO> {
    return this.site.create(tenant.restaurantId, body);
  }

  @Get(':pageId')
  @RequirePermission('campaigns.view')
  get(@Tenant() tenant: TenantContext, @ZodParam('pageId', UuidSchema) pageId: string): Promise<SitePageDTO> {
    return this.site.get(tenant.restaurantId, pageId);
  }

  @Put(':pageId')
  @RequirePermission('campaigns.manage')
  update(
    @Tenant() tenant: TenantContext,
    @ZodParam('pageId', UuidSchema) pageId: string,
    @ZodBody(UpsertSitePageSchema) body: UpsertSitePageInput,
  ): Promise<SitePageDTO> {
    return this.site.update(tenant.restaurantId, pageId, body);
  }

  @Delete(':pageId')
  @HttpCode(204)
  @RequirePermission('campaigns.manage')
  async remove(@Tenant() tenant: TenantContext, @ZodParam('pageId', UuidSchema) pageId: string): Promise<void> {
    await this.site.remove(tenant.restaurantId, pageId);
  }
}

const PageQuerySchema = z
  .object({ locale: LocaleCodeSchema, path: SitePagePathSchema, kind: z.enum(SITE_PAGE_KINDS).default('PAGE') })
  .strict();
const PlaceSegment = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(60);

/** What the public site and search engines read (docs/SEO.md); read-only, rate limited per client. */
@Controller('public/site')
@UseGuards(PublicRateLimitGuard)
@RateLimit({ bucket: 'site', limit: 600, windowSeconds: 60 })
export class PublicSiteController {
  constructor(private readonly site: SiteService) {}

  @Get('page')
  page(@ZodQuery(PageQuerySchema) query: z.infer<typeof PageQuerySchema>): Promise<PublicSitePageDTO> {
    return this.site.publicPage(query.locale, query.path, query.kind);
  }

  @Get('blog')
  blog(): Promise<BlogIndexDTO> {
    return this.site.blogIndex();
  }

  @Get('llms')
  llms(): Promise<LlmsDTO> {
    return this.site.llms();
  }

  @Get('districts/:city/:district')
  district(
    @ZodParam('city', PlaceSegment) city: string,
    @ZodParam('district', PlaceSegment) district: string,
  ): Promise<DistrictLandingDTO> {
    return this.site.district(city, district);
  }

  @Get('restaurants/:slug')
  restaurant(@ZodParam('slug', SlugSchema) slug: string): Promise<RestaurantSeoDTO> {
    return this.site.restaurantSeo(slug);
  }

  @Get('sitemap')
  sitemap(): Promise<SitemapDTO> {
    return this.site.sitemap();
  }
}
