import { DispatchBoard } from '@/components/panel/DispatchBoard';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';
import { mapTilesConfig } from '@/lib/server-env';

export default async function DispatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'dispatch.view');
  const locale = await getLocale();
  return (
    <DispatchBoard
      restaurantId={membership.restaurantId}
      locale={locale}
      canManage={can('dispatch.manage')}
      tiles={mapTilesConfig()}
    />
  );
}
