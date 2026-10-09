import { notFound } from 'next/navigation';
import { WalletProviderSchema, appWalletReturnSchemeUrl } from '@resget/shared';
import { ThemeRoot } from '@/components/ThemeRoot';
import { Card, LinkButton } from '@/components/ui';
import { getT } from '@/lib/i18n';

/**
 * Return address of a wallet linked from the mobile app (docs/CUZDAN.md,
 * "Mobil uygulama"). The app normally claims this universal link; when the
 * browser kept it, this page reopens the app on its own scheme with the same
 * parameters. The web never completes the link here: the card belongs to
 * the account signed in on the app.
 */
export default async function AppWalletReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = WalletProviderSchema.safeParse((await params).code);
  if (!parsed.success) notFound();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') query.set(key, value);
  }
  const { t } = await getT();
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <Card title={t('wallets.app.returnTitle')} data-app-wallet-return>
          <div className="flex flex-col gap-4">
            <p>{t('wallets.app.returnBody')}</p>
            <LinkButton href={appWalletReturnSchemeUrl(parsed.data, query.toString())} block>
              {t('wallets.app.open')}
            </LinkButton>
          </div>
        </Card>
      </main>
    </ThemeRoot>
  );
}
