import { PartnerReferralCard } from '@/components/panel/PartnerReferralCard';
import { PlanAndCredits } from '@/components/panel/PlanAndCredits';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function PlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'subscription.manage');
  const locale = await getLocale();
  return (
    <div className="flex flex-col gap-6">
      <PlanAndCredits
        restaurantId={membership.restaurantId}
        locale={locale}
        plan={membership.effectivePlan}
        planName={membership.planName}
        canMessaging={can('messaging.manage')}
      />
      {membership.features.includes('partner_referrals') && (
        <PartnerReferralCard restaurantId={membership.restaurantId} locale={locale} />
      )}
    </div>
  );
}
