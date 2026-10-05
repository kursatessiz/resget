import { notFound } from 'next/navigation';
import { SocialAccountsManager } from '@/components/panel/SocialAccountsManager';
import { LeadAdsList } from '@/components/panel/LeadAdsList';
import { getT } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

/** The platform's own social accounts: its Facebook page and Instagram account (docs/ENTEGRASYON_MERKEZI.md). */
export default async function MarketingIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string }>;
}) {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  const { context } = access;
  if (!context.features.includes('integration_hub') || !context.permissions.includes('platform.integrations.manage')) {
    notFound();
  }
  const { meta } = await searchParams;
  const { t, locale } = await getT();
  const leadAds = context.features.includes('lead_ads');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="ui-title">{t('marketing.nav.integrations')}</h1>
      <SocialAccountsManager
        restaurantId={context.restaurantId}
        locale={locale}
        returnPath="/pazarlama/entegrasyonlar"
        result={meta ?? null}
        leadAds={leadAds}
      />
      {leadAds && context.permissions.includes('platform.marketing.view') && (
        <LeadAdsList
          restaurantId={context.restaurantId}
          locale={locale}
          canRetry
          pipelineHref="/pazarlama/satis-hatti"
        />
      )}
    </div>
  );
}
