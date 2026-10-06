import { notFound, redirect } from 'next/navigation';
import { WalletProviderSchema } from '@resget/shared';
import { ThemeRoot } from '@/components/ThemeRoot';
import { WalletLinkReturn } from '@/components/WalletLinkReturn';
import { getLocale } from '@/lib/i18n';
import { getMe } from '@/lib/api-server';

/** Where a wallet returns after linking (docs/CUZDAN.md); the account page follows. */
export default async function WalletReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = WalletProviderSchema.safeParse((await params).code);
  if (!parsed.success) notFound();
  const me = await getMe();
  if (!me) redirect('/giris?next=/hesabim');
  const payload = Object.fromEntries(
    Object.entries(await searchParams).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <WalletLinkReturn code={parsed.data} payload={payload} locale={await getLocale()} />
      </main>
    </ThemeRoot>
  );
}
