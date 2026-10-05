import { ApiKeysManager } from '@/components/panel/ApiKeysManager';
import { WebhooksManager } from '@/components/panel/WebhooksManager';
import { PosManager } from '@/components/panel/PosManager';
import { EmailManager } from '@/components/panel/EmailManager';
import { AdsManager } from '@/components/panel/AdsManager';
import { SocialAccountsManager } from '@/components/panel/SocialAccountsManager';
import { LeadAdsList } from '@/components/panel/LeadAdsList';
import { RESTAURANT_CONVERSION_TYPES } from '@resget/shared';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** PRO: API keys for the restaurant's own systems (docs/API_ERISIMI.md). */
export default async function IntegrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ meta?: string }>;
}) {
  const { slug } = await params;
  const { meta } = await searchParams;
  const { membership } = await requireMembership(slug, 'integrations.manage');
  const locale = await getLocale();
  // The public API address is what a restaurant's own system calls; the BFF address is only for this browser.
  const apiBaseUrl = (process.env.PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');
  const hub = membership.features.includes('integration_hub');
  const leadAds = hub && membership.features.includes('lead_ads');
  return (
    <div className="flex flex-col gap-6">
      {hub && (
        <SocialAccountsManager
          restaurantId={membership.restaurantId}
          locale={locale}
          returnPath={`/panel/${slug}/entegrasyon`}
          result={meta ?? null}
          leadAds={leadAds}
        />
      )}
      {leadAds && membership.permissions.includes('customers.view') && (
        <LeadAdsList
          restaurantId={membership.restaurantId}
          locale={locale}
          canRetry
          pipelineHref={`/panel/${slug}/satis-hatti`}
        />
      )}
      <ApiKeysManager
        restaurantId={membership.restaurantId}
        locale={locale}
        isPro={membership.entitlements.includes('api_access')}
        apiBaseUrl={apiBaseUrl}
      />
      <WebhooksManager
        restaurantId={membership.restaurantId}
        locale={locale}
        isPro={membership.entitlements.includes('api_access')}
      />
      {membership.features.includes('pos_integration') && (
        <PosManager restaurantId={membership.restaurantId} locale={locale} apiBaseUrl={apiBaseUrl} />
      )}
      {membership.features.includes('email_channel') && (
        <EmailManager restaurantId={membership.restaurantId} locale={locale} />
      )}
      {membership.features.includes('ad_integrations') && membership.entitlements.includes('analytics') && (
        <AdsManager
          restaurantId={membership.restaurantId}
          locale={locale}
          conversionTypes={RESTAURANT_CONVERSION_TYPES}
        />
      )}
    </div>
  );
}
