import type { Metadata } from 'next';
import { cache } from 'react';
import type { DistrictLandingDTO, PublicSitePageDTO, RestaurantSeoDTO } from '@resget/shared';
import { getT } from '@/lib/i18n';
import { apiInternalBaseUrl, publicSiteUrl } from '@/lib/server-env';

/**
 * Public site reads (docs/SEO.md), deduplicated per request with React
 * cache so a page and its metadata share one API call. null means 404.
 */
async function read<T>(path: string): Promise<T | null> {
  const res = await fetch(`${apiInternalBaseUrl()}${path}`, { cache: 'no-store' });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Site request ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

export const getSitePage = cache((locale: string, path: string) =>
  read<PublicSitePageDTO>(`/public/site/page?${new URLSearchParams({ locale, path }).toString()}`),
);

export const getDistrictLanding = cache((city: string, district: string) =>
  read<DistrictLandingDTO>(`/public/site/districts/${encodeURIComponent(city)}/${encodeURIComponent(district)}`),
);

export const getRestaurantSeo = cache((slug: string) =>
  read<RestaurantSeoDTO>(`/public/site/restaurants/${encodeURIComponent(slug)}`),
);

/** The address search engines should index for a restaurant: its own verified domain, else its page here. */
export function canonicalOf(seo: RestaurantSeoDTO): string {
  return seo.customDomain ? `https://${seo.customDomain}/` : `${publicSiteUrl()}/${seo.slug}`;
}

/**
 * Title, description, canonical address and Open Graph of a restaurant's
 * menu (docs/SEO.md). The ordering page and every table QR page share it, so
 * table links consolidate onto the restaurant page instead of competing.
 */
export async function restaurantMetadata(slug: string): Promise<Metadata> {
  const seo = await getRestaurantSeo(slug);
  if (!seo) return {};
  const { t } = await getT();
  const title = t('site.restaurant.metaTitle', { restaurant: seo.name });
  const description = seo.address
    ? t('site.restaurant.metaDescription', {
        restaurant: seo.name,
        district: seo.address.district,
        city: seo.address.city,
      })
    : t('site.restaurant.metaDescriptionNoAddress', { restaurant: seo.name });
  const url = canonicalOf(seo);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      title,
      description,
      url,
      siteName: seo.name,
      ...(seo.logoUrl ? { images: [{ url: seo.logoUrl }] } : {}),
    },
  };
}
