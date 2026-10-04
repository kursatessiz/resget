import { notFound } from 'next/navigation';
import { ConsentTokenSchema } from '@resget/shared';
import { ConsentConfirm } from '@/components/ConsentConfirm';
import { ThemeRoot } from '@/components/ThemeRoot';
import { getT } from '@/lib/i18n';

/**
 * The double opt-in link (docs/RIZA.md). Opening the page confirms nothing:
 * link previews and mail scanners open links too. The person presses the
 * button, and only that posts the confirmation.
 */
export default async function ConsentConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!ConsentTokenSchema.safeParse(token).success) notFound();
  const { t, locale } = await getT();
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-16">
        <h1 className="ui-title">{t('consent.confirm.title')}</h1>
        <p className="ui-text-muted">{t('consent.confirm.intro')}</p>
        <ConsentConfirm token={token} locale={locale} />
      </main>
    </ThemeRoot>
  );
}
