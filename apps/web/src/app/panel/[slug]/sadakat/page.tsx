import { LoyaltyManager } from '@/components/panel/LoyaltyManager';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** PRO: the loyalty program (docs/SADAKAT.md). BASIC sees the rules read-only and the plan note. */
export default async function LoyaltyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'loyalty.view');
  const locale = await getLocale();
  return (
    <LoyaltyManager
      restaurantId={membership.restaurantId}
      locale={locale}
      canManage={can('loyalty.manage')}
      isPro={membership.effectivePlan === 'PRO'}
    />
  );
}
