import { redirect } from 'next/navigation';
import { Card, LinkButton } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { getMe } from '@/lib/api-server';

export default async function PanelOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const me = await getMe();
  if (!me) redirect(`/giris?next=/panel/${slug}`);
  const membership = me.memberships.find((m) => m.restaurantSlug === slug);
  if (!membership) redirect('/panel');
  const { t } = await getT();
  const can = (permission: string) => membership.permissions.includes(permission as never);
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('panel.overview.title')}</h1>
        <p className="ui-text-muted">{t('panel.overview.welcome', { name: me.user.fullName })}</p>
      </header>
      <Card title={t('panel.role', { role: t(`roles.default.${membership.roleName}`) })}>
        <p className="ui-text-muted">{t('panel.overview.hint')}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {can('orders.view') && (
            <LinkButton href={`/panel/${slug}/siparisler`}>{t('panel.overview.openOrders')}</LinkButton>
          )}
          {can('dispatch.view') && (
            <LinkButton href={`/panel/${slug}/sevk`} variant="outline" tone="muted">
              {t('panel.overview.openDispatch')}
            </LinkButton>
          )}
        </div>
      </Card>
    </>
  );
}
