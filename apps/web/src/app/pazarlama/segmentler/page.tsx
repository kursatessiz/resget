import { notFound } from 'next/navigation';
import { SegmentsManager } from '@/components/panel/SegmentsManager';
import { getLocale } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

/** Saved audiences of the platform's contacts (docs/SEGMENTLER.md). */
export default async function MarketingSegmentsPage() {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  const { context } = access;
  if (!context.features.includes('segments_v2')) notFound();
  const locale = await getLocale();
  return (
    <SegmentsManager
      restaurantId={context.restaurantId}
      locale={locale}
      canManage={context.permissions.includes('platform.marketing.send')}
      withStages={context.features.includes('contacts_crm')}
    />
  );
}
