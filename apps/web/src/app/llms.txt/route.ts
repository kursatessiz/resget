import { headers } from 'next/headers';
import { BUNDLED_MESSAGES, markdownInline } from '@resget/shared';
import { getT } from '@/lib/i18n';
import { hostOf, isPlatformHost } from '@/lib/hosts';
import { publicSiteUrl } from '@/lib/server-env';
import { getLlms } from '@/lib/site';

export const dynamic = 'force-dynamic';

/**
 * /llms.txt (llmstxt.org, docs/SEO.md): the platform site as a short
 * Markdown index that language models read. Built from published pages,
 * posts and launched districts while page_engine is on; tenant text is
 * flattened to one line so it can never add links or headings of its own.
 */
export async function GET() {
  const host = hostOf((await headers()).get('host'));
  if (host && !isPlatformHost(host)) return new Response('Not found', { status: 404 });
  const data = await getLlms();
  if (!data) return new Response('Not found', { status: 404 });
  const { t } = await getT(BUNDLED_MESSAGES[data.locale] ? data.locale : undefined);
  const base = publicSiteUrl();
  const site = markdownInline(data.siteName);
  const link = (label: string, path: string, note?: string) =>
    `- [${markdownInline(label)}](${base}${path})${note ? `: ${markdownInline(note)}` : ''}`;
  const lines = [
    `# ${site}`,
    '',
    `> ${markdownInline(t('site.llms.summary', { site }))}`,
    '',
    `## ${t('site.llms.links')}`,
    '',
    link(t('site.llms.home'), '/'),
    link(t('site.llms.marketplace'), '/pazaryeri'),
    ...(data.posts.length > 0 ? [link(t('site.llms.blogIndex'), '/blog')] : []),
  ];
  const section = (title: string, items: string[]) => {
    if (items.length > 0) lines.push('', `## ${title}`, '', ...items);
  };
  section(
    t('site.llms.pages'),
    data.pages.map((p) => link(p.title, p.path, p.description)),
  );
  section(
    t('site.llms.posts'),
    data.posts.map((p) => link(p.title, p.path, p.description)),
  );
  section(
    t('site.llms.districts'),
    data.districts.map((d) => link(t('site.llms.district', { city: d.city, district: d.district }), d.path)),
  );
  return new Response(`${lines.join('\n')}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
