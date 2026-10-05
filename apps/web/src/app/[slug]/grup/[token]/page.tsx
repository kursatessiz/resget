import { notFound } from 'next/navigation';
import { GroupCartTokenSchema, SlugSchema } from '@resget/shared';
import type { StorefrontDTO, StorefrontViewerDTO } from '@resget/shared';
import { GroupOrder } from '@/components/GroupOrder';
import { ThemeRoot } from '@/components/ThemeRoot';
import { apiFetch, getMe } from '@/lib/api-server';
import { getT } from '@/lib/i18n';
import { apiInternalBaseUrl } from '@/lib/server-env';

/** A shared basket on the restaurant's page (docs/GRUP_SIPARISI.md). */
export default async function GroupOrderPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  if (!SlugSchema.safeParse(slug).success || !GroupCartTokenSchema.safeParse(token).success) notFound();
  const res = await fetch(`${apiInternalBaseUrl()}/public/restaurants/${slug}/menu`, { cache: 'no-store' });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`Restaurant request failed with ${res.status}`);
  const storefront = (await res.json()) as StorefrontDTO;
  if (!storefront.groupOrders) notFound();
  const { t, locale } = await getT();
  const me = await getMe().catch(() => null);
  const viewerRes = me ? await apiFetch(`/me/viewer?restaurantId=${storefront.restaurant.id}`) : null;
  const viewer = viewerRes?.ok ? ((await viewerRes.json()) as StorefrontViewerDTO) : null;
  return (
    <ThemeRoot
      tenantTheme={{ themePrimary: storefront.restaurant.themePrimary, logoUrl: storefront.restaurant.logoUrl }}
    >
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="ui-title">{t('shop.restaurant.title', { restaurant: storefront.restaurant.name })}</h1>
        </header>
        <GroupOrder storefront={storefront} locale={locale} token={token} viewer={viewer} />
      </main>
    </ThemeRoot>
  );
}
