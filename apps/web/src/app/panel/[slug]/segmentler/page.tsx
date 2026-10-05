import { notFound } from 'next/navigation';
import { SegmentsManager } from '@/components/panel/SegmentsManager';
import { Card } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** Saved audiences with an AND / OR rule language (docs/SEGMENTLER.md); part of PRO campaigns. */
export default async function SegmentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'campaigns.view');
  if (!membership.features.includes('segments_v2')) notFound();
  const { t, locale } = await getT();
  if (!membership.entitlements.includes('campaigns')) {
    return (
      <Card title={t('segments.title')}>
        <p>{t('segments.proRequired')}</p>
      </Card>
    );
  }
  return (
    <SegmentsManager
      restaurantId={membership.restaurantId}
      locale={locale}
      canManage={can('campaigns.manage')}
      withStages={membership.features.includes('contacts_crm') && can('customers.view')}
      withChurn={membership.features.includes('churn_signals')}
    />
  );
}
