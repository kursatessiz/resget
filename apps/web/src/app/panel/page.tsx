import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ThemeRoot } from '@/components/ThemeRoot';
import { Card, LinkButton } from '@/components/ui';
import { SignOutButton } from '@/components/SignOutButton';
import { getT } from '@/lib/i18n';
import { getMe } from '@/lib/api-server';
import { RESTAURANT_COOKIE } from '@/lib/session';

/**
 * Restaurant switcher. One membership opens straight away; several are
 * listed; none shows the invitation hint. The middleware already made sure
 * there is a session.
 */
export default async function PanelIndexPage() {
  const me = await getMe();
  if (!me) redirect('/giris?next=/panel');
  const { t } = await getT();
  const memberships = me.memberships;
  if (memberships.length === 1) redirect(`/panel/${memberships[0].restaurantSlug}`);
  const last = (await cookies()).get(RESTAURANT_COOKIE)?.value;
  const preferred = memberships.find((m) => m.restaurantId === last);
  if (preferred && memberships.length > 1) redirect(`/panel/${preferred.restaurantSlug}`);

  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
        <header className="flex flex-col gap-1">
          <h1 className="ui-title">{t('panel.title')}</h1>
          <p className="ui-text-muted">{t('auth.signedInAs', { name: me.user.fullName })}</p>
        </header>
        {memberships.length === 0 ? (
          <Card>
            <p>{t('auth.noMembership')}</p>
          </Card>
        ) : (
          <Card title={t('auth.chooseRestaurant')}>
            <ul className="pui-list pui-hoverable">
              {memberships.map((m) => (
                <li key={m.membershipId} className="pui-list-item flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span>{m.restaurantName}</span>
                    <span className="ui-caption">{t('panel.role', { role: t(`roles.default.${m.roleName}`) })}</span>
                  </div>
                  <LinkButton href={`/panel/${m.restaurantSlug}`} variant="soft">
                    {t('auth.continue')}
                  </LinkButton>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div>
          <SignOutButton label={t('nav.signOut')} />
        </div>
      </main>
    </ThemeRoot>
  );
}
