import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  BUNDLED_MESSAGES,
  LocaleCodeSchema,
  SitePagePathSchema,
  blogPostPath,
  blogPostingJsonLd,
  breadcrumbJsonLd,
  faqJsonLd,
} from '@resget/shared';
import { JsonLdScript } from '@/components/site/JsonLdScript';
import { SiteBlocks } from '@/components/site/SiteBlocks';
import { ThemeRoot } from '@/components/ThemeRoot';
import { getT } from '@/lib/i18n';
import { publicSiteUrl } from '@/lib/server-env';
import { getSitePage } from '@/lib/site';

type Params = Promise<{ locale: string; slug: string }>;

async function load(params: Params) {
  const { locale, slug } = await params;
  if (!LocaleCodeSchema.safeParse(locale).success || !SitePagePathSchema.safeParse(slug).success) return null;
  return getSitePage(locale, slug, 'POST');
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const post = await load(params);
  if (!post) return {};
  const url = blogPostPath(post.locale, post.path);
  return {
    title: post.title,
    description: post.description,
    alternates: {
      canonical: url,
      ...(post.alternates.length > 0
        ? {
            languages: Object.fromEntries([
              [post.locale, url],
              ...post.alternates.map((a) => [a.locale, blogPostPath(a.locale, a.path)]),
            ]),
          }
        : {}),
    },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      url,
      locale: post.locale,
      ...(post.publishedAt ? { publishedTime: post.publishedAt } : {}),
      modifiedTime: post.updatedAt,
      ...(post.authorName ? { authors: [post.authorName] } : {}),
    },
  };
}

/** A blog post (docs/BLOG.md): the page engine's blocks under a title and byline. */
export default async function BlogPostPage({ params }: { params: Params }) {
  const post = await load(params);
  if (!post) notFound();
  const { t } = await getT(BUNDLED_MESSAGES[post.locale] ? post.locale : undefined);
  const base = publicSiteUrl();
  const url = `${base}${blogPostPath(post.locale, post.path)}`;
  const published = post.publishedAt ?? post.updatedAt;
  const faqs = post.blocks.flatMap((b) => (b.type === 'faq' ? b.items : []));
  return (
    <ThemeRoot tenantTheme={null}>
      <main lang={post.locale} className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
        <p className="ui-caption">
          <a href="/blog">{t('site.blog.back')}</a>
        </p>
        <article className="flex flex-col gap-8">
          <header className="flex flex-col gap-2">
            <h1 className="ui-display">{post.title}</h1>
            <p className="ui-caption">
              {t('site.blog.byline', {
                author: post.authorName ?? '',
                date: new Intl.DateTimeFormat(post.locale, { dateStyle: 'long' }).format(new Date(published)),
              })}
            </p>
          </header>
          <SiteBlocks
            blocks={post.blocks}
            headingLevel="h2"
            labels={{ openMenu: t('site.page.openMenu'), noRestaurants: t('site.page.noRestaurants') }}
          />
        </article>
      </main>
      <JsonLdScript
        data={blogPostingJsonLd(
          {
            title: post.title,
            description: post.description,
            locale: post.locale,
            publishedAt: published,
            updatedAt: post.updatedAt,
          },
          { name: post.authorName ?? '', isOrganization: post.authorIsSite },
          url,
        )}
      />
      <JsonLdScript
        data={breadcrumbJsonLd([
          { name: t('site.page.home'), url: `${base}/` },
          { name: t('site.blog.title'), url: `${base}/blog` },
          { name: post.title, url },
        ])}
      />
      {faqs.length > 0 && <JsonLdScript data={faqJsonLd(faqs)} />}
    </ThemeRoot>
  );
}
