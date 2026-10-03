import { OrdersBoard } from '@/components/panel/OrdersBoard';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function OrdersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'orders.view');
  const locale = await getLocale();
  return <OrdersBoard restaurantId={membership.restaurantId} locale={locale} canManage={can('orders.manage')} />;
}
