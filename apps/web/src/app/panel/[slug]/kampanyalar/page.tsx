import { CampaignsManager } from '@/components/panel/CampaignsManager';
import { Badge, Card, LinkButton } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** PRO: the campaign tool (docs/KAMPANYALAR.md). BASIC sees the plan rule and the parts that are ready. */
export default async function CampaignsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'campaigns.view');
  const { t, locale } = await getT();
  if (membership.effectivePlan === 'PRO') {
    return (
      <CampaignsManager restaurantId={membership.restaurantId} locale={locale} canManage={can('campaigns.manage')} />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('campaigns.title')}</h1>
        <p className="ui-text-muted">{t('campaigns.intro')}</p>
      </header>
      <Card
        title={t('campaigns.title')}
        aside={<Badge tone="muted">{t(`panel.plan.${membership.effectivePlan}`)}</Badge>}
      >
        <p>{t('campaigns.proRequired')}</p>
        <div className="flex flex-col gap-2 md:flex-row">
          {can('customers.view') && (
            <LinkButton href={`/panel/${slug}/musteriler`} variant="outline" tone="muted">
              {t('campaigns.openCustomers')}
            </LinkButton>
          )}
          {can('subscription.manage') && (
            <LinkButton href={`/panel/${slug}/plan`} variant="outline" tone="muted">
              {t('plans.upgrade')}
            </LinkButton>
          )}
        </div>
      </Card>
    </div>
  );
}
