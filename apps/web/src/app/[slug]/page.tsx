import { notFound } from 'next/navigation';
import { SlugSchema } from '@resget/shared';
import type { StorefrontDTO } from '@resget/shared';
import { Storefront } from '@/components/Storefront';
import { ThemeRoot } from '@/components/ThemeRoot';
import { getT } from '@/lib/i18n';
import { apiInternalBaseUrl } from '@/lib/server-env';

/** The restaurant's own ordering page (docs/VITRIN.md): delivery and pickup, in the restaurant's colors. */
export default async function RestaurantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SlugSchema.safeParse(slug).success) notFound();
  const res = await fetch(`${apiInternalBaseUrl()}/public/restaurants/${slug}/menu`, { cache: 'no-store' });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`Restaurant request failed with ${res.status}`);
  const storefront = (await res.json()) as StorefrontDTO;
  const { t, locale } = await getT();
  return (
    <ThemeRoot
      tenantTheme={{ themePrimary: storefront.restaurant.themePrimary, logoUrl: storefront.restaurant.logoUrl }}
    >
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
        <header className="flex flex-col gap-2">
          {storefront.restaurant.logoUrl && (
            <img
              src={storefront.restaurant.logoUrl}
              alt=""
              width={64}
              height={64}
              className="h-16 w-16 object-contain"
            />
          )}
          <h1 className="ui-title">{t('shop.restaurant.title', { restaurant: storefront.restaurant.name })}</h1>
          <p className="ui-text-muted">{t('shop.restaurant.intro')}</p>
        </header>
        <Storefront storefront={storefront} locale={locale} source={{ kind: 'site' }} />
        <footer className="ui-rule pt-4">
          <p className="ui-caption text-center">{t('qr.page.poweredBy')}</p>
        </footer>
      </main>
    </ThemeRoot>
  );
}
