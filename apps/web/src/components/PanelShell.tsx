import Link from 'next/link';
import { visibleNav } from '@resget/shared';
import type { MembershipSummaryDTO } from '@resget/shared';
import { SignOutButton } from '@/components/SignOutButton';
import type { Translate } from '@resget/shared';
import type { ReactNode } from 'react';

/**
 * Sidebar and header of the restaurant panel. The navigation renders from
 * the member's effective permissions (PANEL_NAV); the switcher link shows
 * only when the user belongs to more than one restaurant.
 */
export function PanelShell({
  membership,
  canSwitch,
  t,
  children,
}: {
  membership: MembershipSummaryDTO;
  canSwitch: boolean;
  t: Translate;
  children: ReactNode;
}) {
  const base = `/panel/${membership.restaurantSlug}`;
  const items = visibleNav(membership.permissions, membership.features);
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row">
      <aside className="flex flex-col gap-4 md:w-60 md:flex-none" aria-label={t('panel.title')}>
        <div className="flex items-center gap-3">
          {membership.logoUrl && (
            <img src={membership.logoUrl} alt="" width={40} height={40} className="h-10 w-10 object-contain" />
          )}
          <div className="flex flex-col gap-1">
            <span className="ui-heading">{membership.restaurantName}</span>
            <span className="ui-caption">{t(`panel.plan.${membership.effectivePlan}`)}</span>
          </div>
        </div>
        <nav>
          <ul className="pui-list pui-hoverable">
            {items.map((item) => (
              <li key={item.key} className="pui-list-item">
                <Link href={`${base}${item.path}`} className="block">
                  {t(`nav.${item.key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-col gap-2">
          {canSwitch && (
            <Link href="/panel" className="pui-btn pui-link pui-muted">
              {t('nav.switchRestaurant')}
            </Link>
          )}
          <SignOutButton label={t('nav.signOut')} />
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-6">{children}</main>
    </div>
  );
}
