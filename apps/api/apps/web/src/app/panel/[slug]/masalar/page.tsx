import { TablesManager } from '@/components/panel/TablesManager';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function TablesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'tables.manage');
  const locale = await getLocale();
  return (
    <TablesManager
      restaurantId={membership.restaurantId}
      slug={slug}
      locale={locale}
      canReports={can('reports.view')}
    />
  );
}
