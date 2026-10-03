import { CourierPanel } from '@/components/panel/CourierPanel';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function CourierPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'courier.manage');
  const locale = await getLocale();
  return (
    <CourierPanel
      restaurantId={membership.restaurantId}
      slug={slug}
      locale={locale}
      canInvite={can('staff.manage')}
      canEditSettings={can('restaurant.settings.manage')}
    />
  );
}
