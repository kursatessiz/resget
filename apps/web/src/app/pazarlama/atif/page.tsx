import { notFound } from 'next/navigation';
import { AttributionReport } from '@/components/panel/AttributionReport';
import { getLocale } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

/** Which channels bring the platform its leads, sign-ups and first payments (docs/ATIF.md). */
export default async function MarketingAttributionPage() {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  if (!access.context.features.includes('attribution')) notFound();
  const locale = await getLocale();
  return <AttributionReport restaurantId={access.context.restaurantId} locale={locale} />;
}
