import { Badge, Card, LinkButton } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** Campaigns are Phase 1 (HANDOVER B2); the screen states the plan rule and points at what is ready today. */
export default async function CampaignsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'campaigns.view');
  const { t } = await getT();
  const isPro = membership.effectivePlan === 'PRO';
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('campaigns.title')}</h1>
        <p className="ui-text-muted">{t('campaigns.intro')}</p>
      </header>
      <Card
        title={t('campaigns.title')}
        aside={<Badge tone={isPro ? 'success' : 'muted'}>{t(`panel.plan.${membership.effectivePlan}`)}</Badge>}
      >
        <p>{isPro ? t('campaigns.comingSoon') : t('campaigns.proRequired')}</p>
        <div className="flex flex-col gap-2 md:flex-row">
          {can('customers.view') && (
            <LinkButton href={`/panel/${slug}/musteriler`} variant="outline" tone="muted">
              {t('campaigns.openCustomers')}
            </LinkButton>
          )}
          {can('subscription.manage') && (
            <LinkButton href={`/panel/${slug}/plan`} variant="outline" tone="muted">
              {isPro ? t('campaigns.openCredits') : t('plans.upgrade')}
            </LinkButton>
          )}
        </div>
      </Card>
    </div>
  );
}
