import { notFound } from 'next/navigation';
import type { MarketplaceAreaDTO } from '@resget/shared';
import { SitePagesManager } from '@/components/panel/SitePagesManager';
import { getLocale } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';
import { apiInternalBaseUrl } from '@/lib/server-env';

/** The platform's own site pages built from blocks (docs/SAYFA_MOTORU.md). */
export default async function MarketingPagesPage() {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  const { context } = access;
  if (!context.features.includes('page_engine')) notFound();
  const locale = await getLocale();
  const res = await fetch(`${apiInternalBaseUrl()}/public/marketplace/areas`, { cache: 'no-store' });
  const areas = res.ok ? ((await res.json()) as MarketplaceAreaDTO[]) : [];
  return (
    <SitePagesManager
      restaurantId={context.restaurantId}
      locale={locale}
      canManage={
        context.permissions.includes('platform.marketing.manage') ||
        context.permissions.includes('platform.marketing.send')
      }
      areas={areas}
      blogEnabled={context.features.includes('blog')}
    />
  );
}
