import { notFound } from 'next/navigation';
import { JourneysManager } from '@/components/panel/JourneysManager';
import { Card } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** Automated flows (docs/AKISLAR.md); part of PRO campaigns. */
export default async function JourneysPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'campaigns.view');
  if (!membership.features.includes('journeys')) notFound();
  const { t, locale } = await getT();
  if (!membership.entitlements.includes('campaigns')) {
    return (
      <Card title={t('journeys.title')}>
        <p>{t('journeys.proRequired')}</p>
      </Card>
    );
  }
  return (
    <JourneysManager
      restaurantId={membership.restaurantId}
      locale={locale}
      canManage={can('campaigns.manage')}
      canApprove={can('campaigns.approve')}
      emailChannel={membership.features.includes('email_channel')}
      segmentsV2={membership.features.includes('segments_v2')}
    />
  );
}
