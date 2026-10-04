import { notFound } from 'next/navigation';
import { PLATFORM_CONVERSION_TYPES } from '@resget/shared';
import { AdsManager } from '@/components/panel/AdsManager';
import { getLocale } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

/** The platform's own ad accounts: leads, restaurant sign-ups and first payments to Meta, Google and TikTok (docs/REKLAM.md). */
export default async function MarketingAdsPage() {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  const { context } = access;
  if (!context.features.includes('ad_integrations')) notFound();
  const locale = await getLocale();
  return <AdsManager restaurantId={context.restaurantId} locale={locale} conversionTypes={PLATFORM_CONVERSION_TYPES} />;
}
