import { ReportsPanel } from '@/components/panel/ReportsPanel';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function ReportsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership } = await requireMembership(slug, 'reports.view');
  const locale = await getLocale();
  return (
    <ReportsPanel restaurantId={membership.restaurantId} locale={locale} isPro={membership.effectivePlan === 'PRO'} />
  );
}
