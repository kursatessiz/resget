import { notFound } from 'next/navigation';
import { ChurnBoard } from '@/components/panel/ChurnBoard';
import { Card } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** Customer churn classes against each customer's own rhythm (docs/KAYIP_RISKI.md); PRO analytics. */
export default async function ChurnPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'customers.view');
  if (!membership.features.includes('churn_signals')) notFound();
  const { t, locale } = await getT();
  if (!membership.entitlements.includes('analytics')) {
    return (
      <Card title={t('churn.title')}>
        <p>{t('churn.proRequired')}</p>
      </Card>
    );
  }
  const withSegments = membership.features.includes('segments_v2') && can('campaigns.view');
  return (
    <ChurnBoard
      restaurantId={membership.restaurantId}
      locale={locale}
      segmentsHref={withSegments ? `/panel/${slug}/segmentler` : null}
    />
  );
}
