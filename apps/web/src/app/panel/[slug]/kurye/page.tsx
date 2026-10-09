import { CourierPanel } from '@/components/panel/CourierPanel';
import { CourierTipsPanel } from '@/components/panel/CourierTipsPanel';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function CourierPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'courier.manage');
  const locale = await getLocale();
  return (
    <div className="flex flex-col gap-6">
      <CourierPanel
        restaurantId={membership.restaurantId}
        slug={slug}
        locale={locale}
        canInvite={can('staff.manage')}
        canEditSettings={can('restaurant.settings.manage')}
      />
      {membership.features.includes('courier_tips') && (
        <CourierTipsPanel restaurantId={membership.restaurantId} locale={locale} canRefund={can('orders.refund')} />
      )}
    </div>
  );
}
