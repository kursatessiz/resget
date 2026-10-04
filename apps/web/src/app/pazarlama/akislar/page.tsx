import { notFound } from 'next/navigation';
import { JourneysManager } from '@/components/panel/JourneysManager';
import { getLocale } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

/** Automated flows to the platform's contacts (docs/AKISLAR.md). */
export default async function MarketingJourneysPage() {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  const { context } = access;
  if (!context.features.includes('journeys')) notFound();
  const locale = await getLocale();
  return (
    <JourneysManager
      restaurantId={context.restaurantId}
      locale={locale}
      canManage={context.permissions.includes('platform.marketing.send')}
      emailChannel={context.features.includes('email_channel')}
      segmentsV2={context.features.includes('segments_v2')}
    />
  );
}
