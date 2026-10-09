import { redirect } from 'next/navigation';
import { InviteTokenSchema, TableQrTokenSchema, safeLocalPath } from '@resget/shared';
import { ThemeRoot } from '@/components/ThemeRoot';
import { SignInForm } from '@/components/SignInForm';
import { Card } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { getMe } from '@/lib/api-server';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; kayit?: string; masa?: string; davet?: string }>;
}) {
  const params = await searchParams;
  // Only a same-origin path may be the return target; anything else goes to the panel.
  const next = safeLocalPath(params.next, '/panel');
  const me = await getMe();
  if (me) redirect(next);
  const register = params.kayit === '1';
  const qrToken = params.masa && TableQrTokenSchema.safeParse(params.masa).success ? params.masa : null;
  const inviteToken = params.davet && InviteTokenSchema.safeParse(params.davet).success ? params.davet : null;
  const { t, locale } = await getT();

  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
        <header className="flex flex-col gap-1">
          <h1 className="ui-title">{register ? t('auth.register.title') : t('auth.signIn.title')}</h1>
          {register && <p className="ui-text-muted">{t('auth.register.help')}</p>}
          {inviteToken && <p className="ui-text-muted">{t('auth.invite.help')}</p>}
        </header>
        <Card>
          <SignInForm locale={locale} next={next} register={register} qrToken={qrToken} inviteToken={inviteToken} />
        </Card>
      </main>
    </ThemeRoot>
  );
}
