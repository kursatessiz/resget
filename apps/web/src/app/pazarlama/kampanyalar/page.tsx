import { notFound } from 'next/navigation';
import { CampaignsManager } from '@/components/panel/CampaignsManager';
import { getLocale } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

/** Campaigns to the platform's contacts, with the restaurants' campaign screen. */
export default async function MarketingCampaignsPage() {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  if (!access.context.features.includes('campaigns')) notFound();
  const locale = await getLocale();
  return (
    <CampaignsManager
      restaurantId={access.context.restaurantId}
      locale={locale}
      canManage={access.context.permissions.includes('platform.marketing.send')}
    />
  );
}
