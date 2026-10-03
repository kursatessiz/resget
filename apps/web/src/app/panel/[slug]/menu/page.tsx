import { MenuManager } from '@/components/panel/MenuManager';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function MenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'menu.view');
  const locale = await getLocale();
  return <MenuManager restaurantId={membership.restaurantId} locale={locale} canManage={can('menu.manage')} />;
}
