import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { ROBOTS_DISALLOW } from '@resget/shared';
import { hostOf, isPlatformHost } from '@/lib/hosts';
import { publicSiteUrl } from '@/lib/server-env';

/** robots.txt (docs/SEO.md): panels, sessions and one-time links stay out; the sitemap is on the platform domain only. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = hostOf((await headers()).get('host'));
  const platform = !host || isPlatformHost(host);
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...ROBOTS_DISALLOW] }],
    ...(platform ? { sitemap: `${publicSiteUrl()}/sitemap.xml` } : {}),
  };
}
