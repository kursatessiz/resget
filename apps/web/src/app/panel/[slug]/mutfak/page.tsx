import { notFound } from 'next/navigation';
import { KitchenDisplay } from '@/components/panel/KitchenDisplay';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** The kitchen display for a tablet in the kitchen (docs/MUTFAK_EKRANI.md). */
export default async function KitchenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'orders.view');
  if (!membership.features.includes('kitchen_display')) notFound();
  const locale = await getLocale();
  return <KitchenDisplay restaurantId={membership.restaurantId} locale={locale} canManage={can('orders.manage')} />;
}
