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
  const { features, permissions } = access.context;
  const approvals = features.includes('marketing_approvals');
  return (
    <CampaignsManager
      restaurantId={access.context.restaurantId}
      locale={locale}
      // Under approvals an editor prepares and submits; only an approver's decision lets it go.
      canManage={
        permissions.includes('platform.marketing.send') ||
        (approvals && permissions.includes('platform.marketing.manage'))
      }
      approvals={approvals}
      canApprove={permissions.includes('platform.marketing.send')}
      aiStudio={features.includes('ai_studio')}
      segmentsV2={access.context.features.includes('segments_v2')}
      campaignsV2={access.context.features.includes('campaigns_v2')}
      emailChannel={access.context.features.includes('email_channel')}
    />
  );
}
