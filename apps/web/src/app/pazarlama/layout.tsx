import Link from 'next/link';
import type { ReactNode } from 'react';
import { visibleMarketingNav } from '@resget/shared';
import { SignOutButton } from '@/components/SignOutButton';
import { ThemeRoot } from '@/components/ThemeRoot';
import { Card } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

/** The platform's own marketing area (docs/PAZARLAMA.md); the menu follows platform permissions and modules. */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const access = await platformAccess();
  const { t } = await getT();
  if (access.kind !== 'ok') {
    return (
      <ThemeRoot tenantTheme={null}>
        <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
          <h1 className="ui-title">{t('marketing.title')}</h1>
          <Card>
            <p role="status">{t(`marketing.${access.kind}`)}</p>
          </Card>
          <SignOutButton label={t('nav.signOut')} />
        </main>
      </ThemeRoot>
    );
  }
  const { context } = access;
  const nav = visibleMarketingNav(context.permissions, context.features);
  return (
    <ThemeRoot tenantTheme={null}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="flex flex-col gap-4 md:w-60 md:flex-none" aria-label={t('marketing.title')}>
          <div className="flex flex-col gap-1">
            <span className="ui-heading">{t('marketing.title')}</span>
            <span className="ui-caption">
              {context.role ? t(`marketing.role.${context.role}`) : t('marketing.role.superAdmin')}
            </span>
          </div>
          <nav>
            <ul className="pui-list pui-hoverable">
              {nav.map((item) => (
                <li key={item.key} className="pui-list-item">
                  <Link href={`/pazarlama${item.path}`} className="block">
                    {t(`marketing.nav.${item.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex flex-col gap-2">
            {context.isSuperAdmin && (
              <Link href="/admin" className="pui-btn pui-link pui-muted">
                {t('marketing.nav.backToConsole')}
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
