import { notFound } from 'next/navigation';
import { AttributionReport } from '@/components/panel/AttributionReport';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** Where the restaurant's customers came from: QR, its own links, ads (docs/ATIF.md). PRO analytics. */
export default async function AttributionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership } = await requireMembership(slug, 'reports.view');
  if (!membership.features.includes('attribution')) notFound();
  const locale = await getLocale();
  return <AttributionReport restaurantId={membership.restaurantId} locale={locale} />;
}
