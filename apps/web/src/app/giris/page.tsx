import { redirect } from 'next/navigation';
import { TableQrTokenSchema } from '@resget/shared';
import { ThemeRoot } from '@/components/ThemeRoot';
import { SignInForm } from '@/components/SignInForm';
import { Card } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { getMe } from '@/lib/api-server';

/** Only same-origin paths may be a return target; anything else goes to the panel. */
function safeNext(value: string | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/panel';
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; kayit?: string; masa?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const me = await getMe();
  if (me) redirect(next);
  const register = params.kayit === '1';
  const qrToken = params.masa && TableQrTokenSchema.safeParse(params.masa).success ? params.masa : null;
  const { t, locale } = await getT();

  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
        <header className="flex flex-col gap-1">
          <h1 className="ui-title">{register ? t('auth.register.title') : t('auth.signIn.title')}</h1>
          {register && <p className="ui-text-muted">{t('auth.register.help')}</p>}
        </header>
        <Card>
          <SignInForm locale={locale} next={next} register={register} qrToken={qrToken} />
        </Card>
      </main>
    </ThemeRoot>
  );
}
