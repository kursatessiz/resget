import { notFound } from 'next/navigation';
import { ReviewsPanel } from '@/components/panel/ReviewsPanel';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** The restaurant's public reviews: answer and report (docs/YORUMLAR.md). */
export default async function ReviewsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'customers.view');
  if (!membership.features.includes('public_reviews')) notFound();
  const locale = await getLocale();
  return <ReviewsPanel restaurantId={membership.restaurantId} locale={locale} canManage={can('customers.manage')} />;
}
