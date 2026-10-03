import { CustomersList } from '@/components/panel/CustomersList';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function CustomersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'customers.view');
  const locale = await getLocale();
  return (
    <CustomersList
      restaurantId={membership.restaurantId}
      locale={locale}
      canManage={can('customers.manage')}
      canSeeOrders={can('orders.view')}
      isPro={membership.effectivePlan === 'PRO'}
    />
  );
}
