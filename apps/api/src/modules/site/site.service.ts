import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SiteBlockSchema, districtPath, placeSlug, sitePagePath } from '@resget/shared';
import type {
  DistrictLandingDTO,
  PublicSiteBlock,
  PublicSitePageDTO,
  RestaurantSeoDTO,
  SiteBlock,
  SitePageDTO,
  SitePageStatus,
  SiteRestaurantCardDTO,
  SitemapDTO,
  SitemapEntryDTO,
  UpsertSitePageInput,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorefrontService } from '../storefront/storefront.service';
import { conflict, forbidden, notFound } from '../../common/api-error';

type PageRow = Prisma.SitePageGetPayload<object>;

/**
 * The platform's own pages, district landing pages and what search engines
 * read (docs/SAYFA_MOTORU.md, docs/SEO.md). Engine pages belong to the
 * platform tenant only; everything public answers 404 while page_engine is
 * off for it, so a page never leaks before the module opens.
 */
@Injectable()
export class SiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly storefront: StorefrontService,
  ) {}

  // -- Pages (platform marketing) -------------------------------------------------------

  async list(restaurantId: string): Promise<SitePageDTO[]> {
    await this.assertPlatform(restaurantId);
    const rows = await this.prisma.sitePage.findMany({
      where: { restaurantId },
      orderBy: [{ path: 'asc' }, { locale: 'asc' }],
    });
    return rows.map((row) => this.toDto(row));
  }

  async get(restaurantId: string, pageId: string): Promise<SitePageDTO> {
    await this.assertPlatform(restaurantId);
    return this.toDto(await this.find(restaurantId, pageId));
  }

  async create(restaurantId: string, input: UpsertSitePageInput): Promise<SitePageDTO> {
    await this.assertPlatform(restaurantId);
    try {
      const row = await this.prisma.sitePage.create({
        data: {
          restaurantId,
          ...this.fields(input),
          publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
        },
      });
      return this.toDto(row);
    } catch (err) {
      throw this.pathTaken(err);
    }
  }

  async update(restaurantId: string, pageId: string, input: UpsertSitePageInput): Promise<SitePageDTO> {
    await this.assertPlatform(restaurantId);
    const before = await this.find(restaurantId, pageId);
    // publishedAt is the first publication; unpublishing keeps it so the date survives a correction.
    const publishedAt =
      input.status === 'PUBLISHED' && before.status !== 'PUBLISHED' && !before.publishedAt
        ? new Date()
        : before.publishedAt;
    try {
      const row = await this.prisma.sitePage.update({
        where: { id: before.id },
        data: { ...this.fields(input), publishedAt },
      });
      return this.toDto(row);
    } catch (err) {
      throw this.pathTaken(err);
    }
  }

  async remove(restaurantId: string, pageId: string): Promise<void> {
    await this.assertPlatform(restaurantId);
    const page = await this.find(restaurantId, pageId);
    await this.prisma.sitePage.delete({ where: { id: page.id } });
  }

  // -- Public ---------------------------------------------------------------------------

  async publicPage(locale: string, path: string): Promise<PublicSitePageDTO> {
    const platformId = await this.enabledPlatformId();
    if (!platformId) throw notFound('SITE_PAGE_NOT_FOUND', 'Page not found');
    const page = await this.prisma.sitePage.findFirst({
      where: { restaurantId: platformId, locale, path, status: 'PUBLISHED' },
    });
    if (!page) throw notFound('SITE_PAGE_NOT_FOUND', 'Page not found');
    const alternates = page.translationKey
      ? await this.prisma.sitePage.findMany({
          where: {
            restaurantId: platformId,
            translationKey: page.translationKey,
            status: 'PUBLISHED',
            id: { not: page.id },
          },
          orderBy: { locale: 'asc' },
          select: { locale: true, path: true },
        })
      : [];
    const blocks: PublicSiteBlock[] = [];
    for (const block of this.blocksOf(page.blocks)) {
      if (block.type === 'restaurants') {
        const [countryCode, city, district] = block.area.split('|');
        blocks.push({ ...block, restaurants: await this.restaurantsIn(countryCode, city, district) });
      } else blocks.push(block);
    }
    return {
      path: page.path,
      locale: page.locale,
      title: page.title,
      description: page.description,
      blocks,
      alternates,
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  /** A launched district by its URL segments (placeSlug of city and district). */
  async district(citySlug: string, districtSlug: string): Promise<DistrictLandingDTO> {
    if (!(await this.enabledPlatformId())) throw notFound('NOT_FOUND', 'District not found');
    const areas = await this.storefront.areas();
    const area = areas.find((a) => placeSlug(a.city) === citySlug && placeSlug(a.district) === districtSlug);
    if (!area) throw notFound('NOT_FOUND', 'District not found');
    return {
      countryCode: area.countryCode,
      city: area.city,
      district: area.district,
      path: districtPath(area.city, area.district),
      restaurants: await this.restaurantsIn(area.countryCode, area.city, area.district),
    };
  }

  /** What a restaurant's ordering page tells search engines; always served, structured data only with page_engine. */
  async restaurantSeo(slug: string): Promise<RestaurantSeoDTO> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { slug, isActive: true, isPlatform: false },
      select: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        defaultLocale: true,
        countryCode: true,
        customDomain: true,
        customDomainVerifiedAt: true,
        branches: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { addressLine: true, district: true, city: true, postalCode: true },
        },
      },
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    const branch = restaurant.branches[0];
    return {
      slug: restaurant.slug,
      name: restaurant.name,
      logoUrl: restaurant.logoUrl,
      defaultLocale: restaurant.defaultLocale,
      address: branch
        ? {
            street: branch.addressLine,
            district: branch.district,
            city: branch.city,
            countryCode: restaurant.countryCode,
            postalCode: branch.postalCode,
          }
        : null,
      customDomain: restaurant.customDomainVerifiedAt ? restaurant.customDomain : null,
      structuredData: await this.features.isEnabled('page_engine', restaurant.id),
    };
  }

  /**
   * Every public address worth indexing on the platform domain: the home
   * page, the marketplace, launched districts, listed restaurants that do not
   * live on their own domain, and published engine pages with their
   * translations. Empty while page_engine is off for the platform.
   */
  async sitemap(): Promise<SitemapDTO> {
    const platformId = await this.enabledPlatformId();
    if (!platformId) return { entries: [] };
    const now = new Date().toISOString();
    const entries: SitemapEntryDTO[] = [
      { path: '/', lastModified: now },
      { path: '/pazaryeri', lastModified: now },
    ];
    const areas = await this.prisma.serviceArea.findMany({
      where: { isLaunched: true },
      orderBy: [{ city: 'asc' }, { district: 'asc' }],
      select: { city: true, district: true, launchedAt: true, createdAt: true },
    });
    for (const area of areas) {
      entries.push({
        path: districtPath(area.city, area.district),
        lastModified: (area.launchedAt ?? area.createdAt).toISOString(),
      });
    }
    const restaurants = await this.prisma.restaurant.findMany({
      where: {
        isActive: true,
        isListed: true,
        isPlatform: false,
        listingSuspendedAt: null,
        OR: [{ customDomain: null }, { customDomainVerifiedAt: null }],
      },
      orderBy: { slug: 'asc' },
      select: { id: true, slug: true, updatedAt: true },
    });
    const shown = await Promise.all(restaurants.map((r) => this.features.isEnabled('marketplace', r.id)));
    restaurants
      .filter((_, index) => shown[index])
      .forEach((r) => entries.push({ path: `/${r.slug}`, lastModified: r.updatedAt.toISOString() }));
    const pages = await this.prisma.sitePage.findMany({
      where: { restaurantId: platformId, status: 'PUBLISHED' },
      orderBy: [{ path: 'asc' }, { locale: 'asc' }],
      select: { locale: true, path: true, translationKey: true, updatedAt: true },
    });
    for (const page of pages) {
      const siblings = page.translationKey ? pages.filter((p) => p.translationKey === page.translationKey) : [];
      entries.push({
        path: sitePagePath(page.locale, page.path),
        lastModified: page.updatedAt.toISOString(),
        ...(siblings.length > 1
          ? { alternates: Object.fromEntries(siblings.map((p) => [p.locale, sitePagePath(p.locale, p.path)])) }
          : {}),
      });
    }
    return { entries };
  }

  // -- Helpers --------------------------------------------------------------------------

  /** The platform tenant's id when page_engine is on for it. */
  private async enabledPlatformId(): Promise<string | null> {
    const platform = await this.prisma.restaurant.findFirst({ where: { isPlatform: true }, select: { id: true } });
    if (!platform) return null;
    return (await this.features.isEnabled('page_engine', platform.id)) ? platform.id : null;
  }

  private async assertPlatform(restaurantId: string): Promise<void> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { isPlatform: true },
    });
    if (!restaurant?.isPlatform) throw forbidden('PLATFORM_ONLY', 'Site pages belong to the platform tenant');
  }

  private async find(restaurantId: string, pageId: string): Promise<PageRow> {
    const page = await this.prisma.sitePage.findFirst({ where: { id: pageId, restaurantId } });
    if (!page) throw notFound('SITE_PAGE_NOT_FOUND', 'Page not found');
    return page;
  }

  private async restaurantsIn(countryCode: string, city: string, district: string): Promise<SiteRestaurantCardDTO[]> {
    try {
      const market = await this.storefront.marketplace({ countryCode, city, district });
      return market.restaurants.map((r) => ({
        slug: r.slug,
        name: r.name,
        logoUrl: r.logoUrl,
        city: r.city ?? market.area.city,
        district: r.district ?? market.area.district,
      }));
    } catch {
      // A block can name a district that has not launched (or was closed): it shows nothing.
      return [];
    }
  }

  private fields(input: UpsertSitePageInput) {
    return {
      path: input.path,
      locale: input.locale,
      title: input.title,
      description: input.description,
      blocks: input.blocks as unknown as Prisma.InputJsonValue,
      translationKey: input.translationKey ?? null,
      status: input.status,
    };
  }

  /** Stored blocks are re-validated on read; one that no longer parses is left out rather than rendered. */
  private blocksOf(value: Prisma.JsonValue): SiteBlock[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const parsed = SiteBlockSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  }

  private pathTaken(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('SITE_PAGE_PATH_TAKEN', 'A page with this path already exists in this language');
    }
    return err;
  }

  private toDto(row: PageRow): SitePageDTO {
    return {
      id: row.id,
      path: row.path,
      locale: row.locale,
      title: row.title,
      description: row.description,
      blocks: this.blocksOf(row.blocks),
      translationKey: row.translationKey,
      status: row.status as SitePageStatus,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
