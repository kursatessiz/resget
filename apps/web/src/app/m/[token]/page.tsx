import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { TableQrTokenSchema } from '@resget/shared';
import type { StorefrontDTO, StorefrontViewerDTO } from '@resget/shared';
import { ConsentManager } from '@/components/ConsentManager';
import { Storefront } from '@/components/Storefront';
import { ThemeRoot } from '@/components/ThemeRoot';
import { LinkButton } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { apiFetch, getMe } from '@/lib/api-server';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { QR_SESSION_COOKIE } from '@/lib/session';
import { consentRegime } from '@/lib/consent';

/**
 * The page behind a table QR sticker (docs/MASA_QR.md, docs/VITRIN.md).
 * Rendered on the server from the API so a guest sees the menu with no app,
 * no install and no sign-in; ordering happens on the same page. The
 * anonymous session cookie makes the funnel measurable.
 */
export default async function TableMenuPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TableQrTokenSchema.safeParse(token).success) notFound();

  const cookieStore = await cookies();
  const session = cookieStore.get(QR_SESSION_COOKIE)?.value;
  const res = await fetch(`${apiInternalBaseUrl()}/public/qr/${token}`, {
    headers: session ? { 'x-qr-session': session } : {},
    cache: 'no-store',
  });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`Menu request failed with ${res.status}`);
  const storefront = (await res.json()) as StorefrontDTO;
  const { t, locale } = await getT();
  const me = await getMe().catch(() => null);
  const viewerRes = me ? await apiFetch(`/me/viewer?restaurantId=${storefront.restaurant.id}`) : null;
  const viewer = viewerRes?.ok ? ((await viewerRes.json()) as StorefrontViewerDTO) : null;
  const mealCards = [
    ...new Set([...storefront.payment.mealCardsOnline, ...storefront.payment.mealCardsOnDelivery].map((c) => c.name)),
  ];

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
          <h1 className="ui-title">{t('qr.page.title', { restaurant: storefront.restaurant.name })}</h1>
          {storefront.table && <p className="ui-text-muted">{t('qr.page.table', { label: storefront.table.label })}</p>}
          {mealCards.length > 0 && (
            <p className="ui-caption">{t('qr.page.mealCards', { cards: mealCards.join(', ') })}</p>
          )}
        </header>

        <Storefront storefront={storefront} locale={locale} source={{ kind: 'qr', token }} viewer={viewer} />

        <section className="flex flex-col gap-3">
          <LinkButton href={`/${storefront.restaurant.slug}`} variant="outline" tone="muted" block>
            {t('qr.page.orderDelivery')}
          </LinkButton>
          {viewer ? (
            <LinkButton href="/hesabim" variant="link" tone="muted" block>
              {t('account.shop.signedInAs', { name: viewer.fullName })} {t('account.shop.open')}
            </LinkButton>
          ) : (
            <LinkButton href={`/giris?kayit=1&masa=${token}&next=/m/${token}`} variant="link" tone="muted" block>
              {t('qr.page.register')}
            </LinkButton>
          )}
        </section>

        <footer className="ui-rule pt-4">
          <p className="ui-caption text-center">{t('qr.page.poweredBy')}</p>
          {storefront.tracking && (
            <div className="flex justify-center">
              <ConsentManager
                target={storefront.restaurant.slug}
                regime={await consentRegime()}
                locale={locale}
                tableToken={token}
              />
            </div>
          )}
        </footer>
      </main>
    </ThemeRoot>
  );
}
