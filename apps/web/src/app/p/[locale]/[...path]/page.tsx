import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  BUNDLED_MESSAGES,
  LocaleCodeSchema,
  SitePagePathSchema,
  breadcrumbJsonLd,
  faqJsonLd,
  sitePagePath,
} from '@resget/shared';
import { JsonLdScript } from '@/components/site/JsonLdScript';
import { SiteBlocks } from '@/components/site/SiteBlocks';
import { ThemeRoot } from '@/components/ThemeRoot';
import { getT } from '@/lib/i18n';
import { publicSiteUrl } from '@/lib/server-env';
import { getSitePage } from '@/lib/site';

type Params = Promise<{ locale: string; path: string[] }>;

async function load(params: Params) {
  const { locale, path } = await params;
  const joined = path.join('/');
  if (!LocaleCodeSchema.safeParse(locale).success || !SitePagePathSchema.safeParse(joined).success) return null;
  return getSitePage(locale, joined);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const page = await load(params);
  if (!page) return {};
  const url = sitePagePath(page.locale, page.path);
  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: url,
      ...(page.alternates.length > 0
        ? {
            languages: Object.fromEntries([
              [page.locale, url],
              ...page.alternates.map((a) => [a.locale, sitePagePath(a.locale, a.path)]),
            ]),
          }
        : {}),
    },
    openGraph: { type: 'website', title: page.title, description: page.description, url, locale: page.locale },
  };
}

/** A page of the platform's own site built from blocks (docs/SAYFA_MOTORU.md). */
export default async function SitePage({ params }: { params: Params }) {
  const page = await load(params);
  if (!page) notFound();
  const { t } = await getT(BUNDLED_MESSAGES[page.locale] ? page.locale : undefined);
  const base = publicSiteUrl();
  const faqs = page.blocks.flatMap((b) => (b.type === 'faq' ? b.items : []));
  return (
    <ThemeRoot tenantTheme={null}>
      <main lang={page.locale} className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-12">
        {!page.blocks.some((b) => b.type === 'hero') && <h1 className="ui-display">{page.title}</h1>}
        <SiteBlocks
          blocks={page.blocks}
          labels={{ openMenu: t('site.page.openMenu'), noRestaurants: t('site.page.noRestaurants') }}
        />
      </main>
      <JsonLdScript
        data={breadcrumbJsonLd([
          { name: t('site.page.home'), url: `${base}/` },
          { name: page.title, url: `${base}${sitePagePath(page.locale, page.path)}` },
        ])}
      />
      {faqs.length > 0 && <JsonLdScript data={faqJsonLd(faqs)} />}
    </ThemeRoot>
  );
}
