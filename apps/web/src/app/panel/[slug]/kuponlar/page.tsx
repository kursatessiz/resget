import { notFound } from 'next/navigation';
import { CouponsManager } from '@/components/panel/CouponsManager';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** PRO: coupons and promo codes (docs/KUPONLAR.md), behind the coupons module switch. */
export default async function CouponsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'campaigns.view');
  if (!membership.features.includes('coupons')) notFound();
  const locale = await getLocale();
  return (
    <CouponsManager
      restaurantId={membership.restaurantId}
      locale={locale}
      canManage={can('campaigns.manage')}
      isPro={membership.effectivePlan === 'PRO'}
    />
  );
}
