import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { blogPostPath, breadcrumbJsonLd } from '@resget/shared';
import { JsonLdScript } from '@/components/site/JsonLdScript';
import { ThemeRoot } from '@/components/ThemeRoot';
import { getT } from '@/lib/i18n';
import { publicSiteUrl } from '@/lib/server-env';
import { getBlogIndex } from '@/lib/site';

export async function generateMetadata(): Promise<Metadata> {
  const blog = await getBlogIndex();
  if (!blog) return {};
  const { t } = await getT();
  const title = t('site.blog.title');
  const description = t('site.blog.metaDescription', { site: blog.siteName });
  return { title, description, alternates: { canonical: '/blog' }, openGraph: { type: 'website', title, description } };
}

/**
 * The platform blog (docs/BLOG.md): published posts, newest first, the
 * viewer's language first. Every post keeps its own language and address.
 */
export default async function BlogIndexPage() {
  const blog = await getBlogIndex();
  if (!blog) notFound();
  const { t, locale } = await getT();
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso));
  const language = locale.split('-')[0];
  // Stable: posts in the viewer's language move up, each group keeps the newest-first order.
  const posts = [...blog.posts].sort(
    (a, b) => Number(b.locale.split('-')[0] === language) - Number(a.locale.split('-')[0] === language),
  );
  const base = publicSiteUrl();
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
        <h1 className="ui-display">{t('site.blog.title')}</h1>
        {posts.length === 0 ? (
          <p className="ui-text-muted">{t('site.blog.empty')}</p>
        ) : (
          <ul className="flex flex-col ui-divide">
            {posts.map((post) => (
              <li key={`${post.locale}/${post.path}`} lang={post.locale} className="flex flex-col gap-2 py-5">
                <h2 className="ui-title">
                  <a href={blogPostPath(post.locale, post.path)}>{post.title}</a>
                </h2>
                <p className="ui-caption">
                  {t('site.blog.byline', {
                    author: post.authorName ?? blog.siteName,
                    date: date(post.publishedAt),
                  })}
                </p>
                <p className="ui-text-muted">{post.description}</p>
                <div>
                  <a
                    href={blogPostPath(post.locale, post.path)}
                    aria-label={`${t('site.blog.readMore')}: ${post.title}`}
                  >
                    {t('site.blog.readMore')}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      <JsonLdScript
        data={breadcrumbJsonLd([
          { name: t('site.page.home'), url: `${base}/` },
          { name: t('site.blog.title'), url: `${base}/blog` },
        ])}
      />
    </ThemeRoot>
  );
}
