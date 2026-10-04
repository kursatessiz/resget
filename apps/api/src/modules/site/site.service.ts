import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { SiteBlockSchema, districtPath, placeSlug, siteEntryPath } from '@resget/shared';
import type {
  BlogIndexDTO,
  DistrictLandingDTO,
  LlmsDTO,
  PublicSiteBlock,
  PublicSitePageDTO,
  RestaurantSeoDTO,
  SiteBlock,
  SitePageDTO,
  SitePageKind,
  SitePageStatus,
  SiteRestaurantCardDTO,
  SitemapDTO,
  SitemapEntryDTO,
  UpsertSitePageInput,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { IndexNowService } from './indexnow.service';
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
    private readonly indexNow: IndexNowService,
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
    if (input.kind === 'POST') await this.features.assertEnabled('blog', restaurantId);
    let row: PageRow;
    try {
      row = await this.prisma.sitePage.create({
        data: {
          restaurantId,
          ...this.fields(input),
          publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
        },
      });
    } catch (err) {
      throw this.pathTaken(err);
    }
    if (row.status === 'PUBLISHED') this.indexNow.notify(this.changedPaths(row));
    return this.toDto(row);
  }

  async update(restaurantId: string, pageId: string, input: UpsertSitePageInput): Promise<SitePageDTO> {
    await this.assertPlatform(restaurantId);
    const before = await this.find(restaurantId, pageId);
    if (input.kind === 'POST' || before.kind === 'POST') await this.features.assertEnabled('blog', restaurantId);
    // publishedAt is the first publication; unpublishing keeps it so the date survives a correction.
    const publishedAt =
      input.status === 'PUBLISHED' && before.status !== 'PUBLISHED' && !before.publishedAt
        ? new Date()
        : before.publishedAt;
    let row: PageRow;
    try {
      row = await this.prisma.sitePage.update({
        where: { id: before.id },
        data: { ...this.fields(input), publishedAt },
      });
    } catch (err) {
      throw this.pathTaken(err);
    }
    // The old address went away or changed, the new one appeared or changed: both are news to a search engine.
    const paths = [
      ...(before.status === 'PUBLISHED' ? this.changedPaths(before) : []),
      ...(row.status === 'PUBLISHED' ? this.changedPaths(row) : []),
    ];
    this.indexNow.notify(paths);
    return this.toDto(row);
  }

  async remove(restaurantId: string, pageId: string): Promise<void> {
    await this.assertPlatform(restaurantId);
    const page = await this.find(restaurantId, pageId);
    await this.prisma.sitePage.delete({ where: { id: page.id } });
    if (page.status === 'PUBLISHED') this.indexNow.notify(this.changedPaths(page));
  }

  // -- Public ---------------------------------------------------------------------------

  async publicPage(locale: string, path: string, kind: SitePageKind): Promise<PublicSitePageDTO> {
    const platform = await this.enabledPlatform(kind === 'POST');
    if (!platform) throw notFound('SITE_PAGE_NOT_FOUND', 'Page not found');
    const platformId = platform.id;
    const page = await this.prisma.sitePage.findFirst({
      where: { restaurantId: platformId, locale, path, kind, status: 'PUBLISHED' },
    });
    if (!page) throw notFound('SITE_PAGE_NOT_FOUND', 'Page not found');
    const alternates = page.translationKey
      ? await this.prisma.sitePage.findMany({
          where: {
            restaurantId: platformId,
            translationKey: page.translationKey,
            kind,
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
      kind,
      path: page.path,
      locale: page.locale,
      title: page.title,
      description: page.description,
      blocks,
      alternates,
      authorName: kind === 'POST' ? (page.authorName ?? platform.name) : null,
      authorIsSite: kind === 'POST' && !page.authorName,
      publishedAt: page.publishedAt?.toISOString() ?? null,
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  /** Published posts, newest first (docs/BLOG.md); 404 while blog or page_engine is off. */
  async blogIndex(): Promise<BlogIndexDTO> {
    const platform = await this.enabledPlatform(true);
    if (!platform) throw notFound('SITE_PAGE_NOT_FOUND', 'Blog not found');
    const posts = await this.prisma.sitePage.findMany({
      where: { restaurantId: platform.id, kind: 'POST', status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { path: 'asc' }],
      take: 100,
      select: { locale: true, path: true, title: true, description: true, authorName: true, publishedAt: true },
    });
    return {
      siteName: platform.name,
      posts: posts.map((p) => ({
        locale: p.locale,
        path: p.path,
        title: p.title,
        description: p.description,
        authorName: p.authorName,
        publishedAt: (p.publishedAt ?? new Date(0)).toISOString(),
      })),
    };
  }

  /** The site for language models (/llms.txt, docs/SEO.md); 404 while page_engine is off. */
  async llms(): Promise<LlmsDTO> {
    const platform = await this.enabledPlatform(false);
    if (!platform) throw notFound('NOT_FOUND', 'Not found');
    const blogOn = await this.features.isEnabled('blog', platform.id);
    const [entries, areas] = await Promise.all([
      this.prisma.sitePage.findMany({
        where: { restaurantId: platform.id, status: 'PUBLISHED', ...(blogOn ? {} : { kind: 'PAGE' }) },
        orderBy: [{ kind: 'asc' }, { path: 'asc' }, { locale: 'asc' }],
        take: 200,
        select: { kind: true, locale: true, path: true, title: true, description: true },
      }),
      this.storefront.areas(),
    ]);
    const line = (e: (typeof entries)[number]) => ({
      title: e.title,
      description: e.description,
      path: siteEntryPath(e.kind as SitePageKind, e.locale, e.path),
    });
    return {
      siteName: platform.name,
      locale: platform.defaultLocale,
      pages: entries.filter((e) => e.kind === 'PAGE').map(line),
      posts: entries.filter((e) => e.kind === 'POST').map(line),
      districts: areas.map((a) => ({ city: a.city, district: a.district, path: districtPath(a.city, a.district) })),
    };
  }

  /** A launched district by its URL segments (placeSlug of city and district). */
  async district(citySlug: string, districtSlug: string): Promise<DistrictLandingDTO> {
    if (!(await this.enabledPlatform(false))) throw notFound('NOT_FOUND', 'District not found');
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
    const platform = await this.enabledPlatform(false);
    if (!platform) return { entries: [] };
    const platformId = platform.id;
    const blogOn = await this.features.isEnabled('blog', platformId);
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
      where: { restaurantId: platformId, status: 'PUBLISHED', ...(blogOn ? {} : { kind: 'PAGE' }) },
      orderBy: [{ kind: 'asc' }, { path: 'asc' }, { locale: 'asc' }],
      select: { kind: true, locale: true, path: true, translationKey: true, updatedAt: true },
    });
    const pathOf = (p: (typeof pages)[number]) => siteEntryPath(p.kind as SitePageKind, p.locale, p.path);
    const posts = pages.filter((p) => p.kind === 'POST');
    if (posts.length > 0) {
      const newest = posts.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
      entries.push({ path: '/blog', lastModified: newest.updatedAt.toISOString() });
    }
    for (const page of pages) {
      const siblings = page.translationKey
        ? pages.filter((p) => p.kind === page.kind && p.translationKey === page.translationKey)
        : [];
      entries.push({
        path: pathOf(page),
        lastModified: page.updatedAt.toISOString(),
        ...(siblings.length > 1 ? { alternates: Object.fromEntries(siblings.map((p) => [p.locale, pathOf(p)])) } : {}),
      });
    }
    return { entries };
  }

  // -- Helpers --------------------------------------------------------------------------

  /** The platform tenant when page_engine (and, for the blog, blog) is on for it. */
  private async enabledPlatform(blog: boolean): Promise<{ id: string; name: string; defaultLocale: string } | null> {
    const platform = await this.prisma.restaurant.findFirst({
      where: { isPlatform: true },
      select: { id: true, name: true, defaultLocale: true },
    });
    if (!platform || !(await this.features.isEnabled('page_engine', platform.id))) return null;
    if (blog && !(await this.features.isEnabled('blog', platform.id))) return null;
    return platform;
  }

  /** Public addresses a change to this entry touches. */
  private changedPaths(row: PageRow): string[] {
    const path = siteEntryPath(row.kind as SitePageKind, row.locale, row.path);
    return row.kind === 'POST' ? [path, '/blog'] : [path];
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
      kind: input.kind,
      authorName: input.kind === 'POST' ? (input.authorName ?? null) : null,
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
      kind: row.kind as SitePageKind,
      authorName: row.authorName,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
