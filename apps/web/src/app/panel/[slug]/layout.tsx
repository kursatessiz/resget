import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThemeRoot } from '@/components/ThemeRoot';
import { PanelShell } from '@/components/PanelShell';
import { getT } from '@/lib/i18n';
import { getMe } from '@/lib/api-server';

/**
 * Every panel page lives under the restaurant's slug. The layout resolves
 * the member's rights in that restaurant once and renders the shell in the
 * restaurant's brand color; pages receive the same slug in their params.
 */
export default async function PanelLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: ReactNode;
}) {
  const { slug } = await params;
  const me = await getMe();
  if (!me) redirect(`/giris?next=/panel/${slug}`);
  const membership = me.memberships.find((m) => m.restaurantSlug === slug);
  if (!membership) notFound();
  const { t } = await getT();
  return (
    <ThemeRoot tenantTheme={{ themePrimary: membership.themePrimary, logoUrl: membership.logoUrl }}>
      <PanelShell membership={membership} canSwitch={me.memberships.length > 1} t={t}>
        {children}
      </PanelShell>
    </ThemeRoot>
  );
}
