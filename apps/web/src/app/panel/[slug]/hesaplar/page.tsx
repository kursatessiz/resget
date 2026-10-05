import { notFound } from 'next/navigation';
import { TabsPanel } from '@/components/panel/TabsPanel';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** The tables' open tabs: the bill, splitting and collecting it (docs/ACIK_HESAP.md). */
export default async function TabsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'orders.view');
  if (!membership.features.includes('table_tabs')) notFound();
  const locale = await getLocale();
  return <TabsPanel restaurantId={membership.restaurantId} locale={locale} canCollect={can('orders.manage')} />;
}
