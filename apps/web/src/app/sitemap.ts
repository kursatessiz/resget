import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import type { SitemapDTO } from '@resget/shared';
import { hostOf, isPlatformHost } from '@/lib/hosts';
import { apiInternalBaseUrl, publicSiteUrl } from '@/lib/server-env';

export const dynamic = 'force-dynamic';

/**
 * sitemap.xml (docs/SEO.md): what the API lists for the platform domain,
 * made absolute, with language versions of engine pages. A restaurant's own
 * domain only serves its home page, so it gets an empty map.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = hostOf((await headers()).get('host'));
  if (host && !isPlatformHost(host)) return [];
  const res = await fetch(`${apiInternalBaseUrl()}/public/site/sitemap`, { cache: 'no-store' });
  if (!res.ok) return [];
  const { entries } = (await res.json()) as SitemapDTO;
  const base = publicSiteUrl();
  return entries.map((entry) => ({
    url: `${base}${entry.path === '/' ? '' : entry.path}`,
    lastModified: entry.lastModified,
    ...(entry.alternates
      ? {
          alternates: {
            languages: Object.fromEntries(
              Object.entries(entry.alternates).map(([locale, path]) => [locale, `${base}${path}`]),
            ),
          },
        }
      : {}),
  }));
}
