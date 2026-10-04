import Link from 'next/link';
import { Card } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

/** Marketing overview: where the platform's marketing modules live and what comes next (docs/PAZARLAMA.md). */
export default async function MarketingOverviewPage() {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  const { t } = await getT();
  const campaignsOn = access.context.features.includes('campaigns');
  const kpiOn = access.context.features.includes('kpi_dashboard');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="ui-title">{t('marketing.nav.overview')}</h1>
      <p className="ui-text-muted">{t('marketing.overview.intro')}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t('marketing.overview.contacts')}>
          <Link href="/pazarlama/kisiler" className="pui-btn pui-link pui-theme">
            {t('marketing.nav.contacts')}
          </Link>
        </Card>
        {campaignsOn && (
          <Card title={t('marketing.overview.campaigns')}>
            <Link href="/pazarlama/kampanyalar" className="pui-btn pui-link pui-theme">
              {t('marketing.nav.campaigns')}
            </Link>
          </Card>
        )}
        {kpiOn && (
          <Card title={t('kpi.title')}>
            <Link href="/pazarlama/huniler" className="pui-btn pui-link pui-theme">
              {t('marketing.nav.funnels')}
            </Link>
          </Card>
        )}
      </div>
      <p className="ui-caption">{t('marketing.overview.roadmap')}</p>
    </div>
  );
}
