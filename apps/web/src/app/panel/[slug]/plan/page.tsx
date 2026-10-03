import { PlanAndCredits } from '@/components/panel/PlanAndCredits';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function PlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'subscription.manage');
  const locale = await getLocale();
  return (
    <PlanAndCredits
      restaurantId={membership.restaurantId}
      locale={locale}
      plan={membership.effectivePlan}
      canMessaging={can('messaging.manage')}
    />
  );
}
