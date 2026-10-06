import { redirect } from 'next/navigation';
import { AccountPanel } from '@/components/AccountPanel';
import { MyReferrals } from '@/components/MyReferrals';
import { MyWallets } from '@/components/MyWallets';
import { ThemeRoot } from '@/components/ThemeRoot';
import { getLocale } from '@/lib/i18n';
import { getMe } from '@/lib/api-server';

/** The customer's own page (docs/VITRIN.md): addresses, details and orders with their tracking links. */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ cuzdan?: string }> }) {
  const me = await getMe();
  if (!me) redirect('/giris?next=/hesabim');
  const locale = await getLocale();
  const { cuzdan } = await searchParams;
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <AccountPanel locale={locale} />
        <MyWallets locale={locale} linked={cuzdan === 'eklendi'} />
        <MyReferrals locale={locale} />
      </main>
    </ThemeRoot>
  );
}
