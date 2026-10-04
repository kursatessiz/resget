import { notFound } from 'next/navigation';
import { FeedbackManager } from '@/components/panel/FeedbackManager';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** Feedback routing and NPS (docs/GERI_BILDIRIM.md): settings, summary and low-rating cases; PRO analytics. */
export default async function FeedbackPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'customers.view');
  if (!membership.features.includes('feedback')) notFound();
  const locale = await getLocale();
  return (
    <FeedbackManager
      restaurantId={membership.restaurantId}
      locale={locale}
      isPro={membership.effectivePlan === 'PRO'}
      canManageSettings={can('restaurant.settings.manage')}
      canManageCases={can('customers.manage')}
      canSeeReports={can('reports.view')}
    />
  );
}
