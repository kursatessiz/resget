import { ApiKeysManager } from '@/components/panel/ApiKeysManager';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** PRO: API keys for the restaurant's own systems (docs/API_ERISIMI.md). */
export default async function IntegrationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership } = await requireMembership(slug, 'integrations.manage');
  const locale = await getLocale();
  // The public API address is what a restaurant's own system calls; the BFF address is only for this browser.
  const apiBaseUrl = (process.env.PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');
  return (
    <ApiKeysManager
      restaurantId={membership.restaurantId}
      locale={locale}
      isPro={membership.effectivePlan === 'PRO'}
      apiBaseUrl={apiBaseUrl}
    />
  );
}
