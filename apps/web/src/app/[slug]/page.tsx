import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SlugSchema, restaurantJsonLd } from '@resget/shared';
import type { StorefrontDTO, StorefrontViewerDTO } from '@resget/shared';
import { ConsentManager } from '@/components/ConsentManager';
import { JsonLdScript } from '@/components/site/JsonLdScript';
import { Storefront } from '@/components/Storefront';
import { ThemeRoot } from '@/components/ThemeRoot';
import { getT } from '@/lib/i18n';
import { apiFetch, getMe } from '@/lib/api-server';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { consentRegime } from '@/lib/consent';
import { canonicalOf, getRestaurantSeo, restaurantMetadata } from '@/lib/site';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!SlugSchema.safeParse(slug).success) return {};
  return restaurantMetadata(slug);
}

/** The restaurant's own ordering page (docs/VITRIN.md): delivery and pickup, in the restaurant's colors. */
export default async function RestaurantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SlugSchema.safeParse(slug).success) notFound();
  const res = await fetch(`${apiInternalBaseUrl()}/public/restaurants/${slug}/menu`, { cache: 'no-store' });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`Restaurant request failed with ${res.status}`);
  const storefront = (await res.json()) as StorefrontDTO;
  const { t, locale } = await getT();
  const me = await getMe().catch(() => null);
  const viewerRes = me ? await apiFetch(`/me/viewer?restaurantId=${storefront.restaurant.id}`) : null;
  const viewer = viewerRes?.ok ? ((await viewerRes.json()) as StorefrontViewerDTO) : null;
  const seo = await getRestaurantSeo(slug).catch(() => null);
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
          {viewer ? (
            <p className="ui-caption">
              {t('account.shop.signedInAs', { name: viewer.fullName })}{' '}
              <Link href="/hesabim">{t('account.shop.open')}</Link>
            </p>
          ) : (
            <p className="ui-caption">
              <Link href={`/giris?kayit=1&next=/${slug}`}>{t('account.shop.signIn')}</Link>{' '}
              {t('account.shop.signInHelp')}
            </p>
          )}
        </header>
        <Storefront storefront={storefront} locale={locale} source={{ kind: 'site' }} viewer={viewer} />
        <footer className="ui-rule pt-4">
          <p className="ui-caption text-center">{t('qr.page.poweredBy')}</p>
          {storefront.tracking && (
            <div className="flex justify-center">
              <ConsentManager target={storefront.restaurant.slug} regime={await consentRegime()} locale={locale} />
            </div>
          )}
        </footer>
      </main>
      {seo?.structuredData && <JsonLdScript data={restaurantJsonLd(seo, canonicalOf(seo))} />}
    </ThemeRoot>
  );
}
