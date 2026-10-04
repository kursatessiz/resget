import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { breadcrumbJsonLd, itemListJsonLd } from '@resget/shared';
import { JsonLdScript } from '@/components/site/JsonLdScript';
import { RestaurantCards } from '@/components/site/RestaurantCards';
import { ThemeRoot } from '@/components/ThemeRoot';
import { LinkButton } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { publicSiteUrl } from '@/lib/server-env';
import { getDistrictLanding } from '@/lib/site';

type Params = Promise<{ city: string; district: string }>;
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function load(params: Params) {
  const { city, district } = await params;
  if (!SEGMENT.test(city) || !SEGMENT.test(district)) return null;
  return getDistrictLanding(city, district);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const landing = await load(params);
  if (!landing) return {};
  const { t } = await getT();
  const vars = { city: landing.city, district: landing.district };
  const title = t('site.district.metaTitle', vars);
  const description = t('site.district.metaDescription', vars);
  return {
    title,
    description,
    alternates: { canonical: landing.path },
    openGraph: { type: 'website', title, description, url: landing.path },
  };
}

/** The landing page of a launched district (docs/SAYFA_MOTORU.md): its listed restaurants, generated, never edited. */
export default async function DistrictPage({ params }: { params: Params }) {
  const landing = await load(params);
  if (!landing) notFound();
  const { t } = await getT();
  const vars = { city: landing.city, district: landing.district };
  const base = publicSiteUrl();
  const area = `${landing.countryCode}|${landing.city}|${landing.district}`;
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
        <header className="flex flex-col gap-2">
          <h1 className="ui-title">{t('site.district.title', vars)}</h1>
          <p className="ui-text-muted">{t('site.district.intro', vars)}</p>
        </header>
        <RestaurantCards
          restaurants={landing.restaurants}
          openLabel={t('site.page.openMenu')}
          emptyLabel={t('site.page.noRestaurants')}
          label={t('site.district.title', vars)}
        />
        <div>
          <LinkButton
            variant="outline"
            tone="muted"
            href={`/pazaryeri?${new URLSearchParams({ bolge: area }).toString()}`}
          >
            {t('site.district.marketplace')}
          </LinkButton>
        </div>
      </main>
      <JsonLdScript
        data={breadcrumbJsonLd([
          { name: t('site.page.home'), url: `${base}/` },
          { name: t('site.district.title', vars), url: `${base}${landing.path}` },
        ])}
      />
      {landing.restaurants.length > 0 && (
        <JsonLdScript
          data={itemListJsonLd(landing.restaurants.map((r) => ({ name: r.name, url: `${base}/${r.slug}` })))}
        />
      )}
    </ThemeRoot>
  );
}
