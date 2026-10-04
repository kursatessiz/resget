import { cache } from 'react';
import type { DistrictLandingDTO, PublicSitePageDTO, RestaurantSeoDTO } from '@resget/shared';
import { apiInternalBaseUrl } from '@/lib/server-env';

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
