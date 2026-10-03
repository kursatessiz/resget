import Link from 'next/link';
import type { ReactNode } from 'react';
import { ADMIN_NAV } from '@resget/shared';
import { SignOutButton } from '@/components/SignOutButton';
import { ThemeRoot } from '@/components/ThemeRoot';
import { getT } from '@/lib/i18n';
import { requireSuperAdmin } from '@/lib/panel';

/** The platform owner's console (docs/PLATFORM_YONETIMI.md); rendered in the platform's own colors. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await requireSuperAdmin();
  const { t } = await getT();
  return (
    <ThemeRoot tenantTheme={null}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="flex flex-col gap-4 md:w-60 md:flex-none" aria-label={t('admin.title')}>
          <div className="flex flex-col gap-1">
            <span className="ui-heading">{t('admin.title')}</span>
            <span className="ui-caption">{me.user.fullName}</span>
          </div>
          <nav>
            <ul className="pui-list pui-hoverable">
              {ADMIN_NAV.map((item) => (
                <li key={item.key} className="pui-list-item">
                  <Link href={`/admin${item.path}`} className="block">
                    {t(`admin.nav.${item.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex flex-col gap-2">
            {me.memberships.length > 0 && (
              <Link href="/panel" className="pui-btn pui-link pui-muted">
                {t('admin.nav.backToPanel')}
              </Link>
            )}
            <SignOutButton label={t('nav.signOut')} />
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col gap-6">{children}</main>
      </div>
    </ThemeRoot>
  );
}
