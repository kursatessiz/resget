import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { TableQrTokenSchema, formatMoney } from '@resget/shared';
import { ThemeRoot } from '@/components/ThemeRoot';
import { LinkButton } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { apiInternalBaseUrl } from '@/lib/server-env';

/** Mirrors PublicMenuDTO of the API. */
interface PublicMenu {
  restaurant: {
    id: string;
    slug: string;
    name: string;
    currency: string;
    logoUrl: string | null;
    themePrimary: string;
    defaultLocale: string;
  };
  table: { id: string; label: string } | null;
  payment: { mealCardsOnline: { name: string }[]; mealCardsOnDelivery: { name: string }[] };
  categories: {
    id: string;
    name: string;
    items: {
      id: string;
      name: string;
      description: string | null;
      priceMinor: number;
      currency: string;
      isAvailable: boolean;
    }[];
  }[];
}

const QR_SESSION_COOKIE = 'resget_qr_session';

/**
 * The page behind a table QR sticker (docs/MASA_QR.md). Rendered on the
 * server from the API so a guest sees the menu with no app, no install and
 * no sign-in. The anonymous session cookie makes the funnel measurable.
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
  const menu = (await res.json()) as PublicMenu;
  const { t, locale } = await getT();
  const mealCards = [
    ...new Set([...menu.payment.mealCardsOnline, ...menu.payment.mealCardsOnDelivery].map((c) => c.name)),
  ];

  return (
    <ThemeRoot tenantTheme={{ themePrimary: menu.restaurant.themePrimary, logoUrl: menu.restaurant.logoUrl }}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="ui-title">{t('qr.page.title', { restaurant: menu.restaurant.name })}</h1>
          {menu.table && <p className="ui-text-muted">{t('qr.page.table', { label: menu.table.label })}</p>}
          {mealCards.length > 0 && (
            <p className="ui-caption">{t('qr.page.mealCards', { cards: mealCards.join(', ') })}</p>
          )}
        </header>

        {menu.categories.map((category) => (
          <section key={category.id} className="flex flex-col gap-3">
            <h2 className="ui-heading">{category.name}</h2>
            <ul className="ui-divide">
              {category.items.length === 0 && <li className="ui-caption py-2">{t('menu.emptyCategory')}</li>}
              {category.items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span className={item.isAvailable ? undefined : 'ui-text-muted'}>{item.name}</span>
                    {item.description && <span className="ui-caption">{item.description}</span>}
                    {!item.isAvailable && <span className="ui-caption">{t('menu.unavailable')}</span>}
                  </div>
                  <span className="ui-price">
                    {formatMoney({ amountMinor: item.priceMinor, currency: item.currency }, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="flex flex-col gap-3">
          <LinkButton href={`/${menu.restaurant.slug}/siparis?masa=${menu.table?.id ?? ''}`} block>
            {t('qr.page.orderToTable')}
          </LinkButton>
          <LinkButton href={`/${menu.restaurant.slug}`} variant="outline" tone="muted" block>
            {t('qr.page.orderDelivery')}
          </LinkButton>
          <p className="ui-caption text-center">{t('qr.page.register')}</p>
        </section>

        <footer className="ui-rule pt-4">
          <p className="ui-caption text-center">{t('qr.page.poweredBy')}</p>
        </footer>
      </main>
    </ThemeRoot>
  );
}
