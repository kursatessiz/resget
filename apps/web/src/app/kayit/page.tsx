import { redirect } from 'next/navigation';
import { SignupForm } from '@/components/SignupForm';
import { ThemeRoot } from '@/components/ThemeRoot';
import { Card } from '@/components/ui';
import { getMe } from '@/lib/api-server';
import { getT } from '@/lib/i18n';

/** Restaurant self sign-up: the phone that signs in becomes the owner (docs/PLATFORM_YONETIMI.md). */
export default async function SignupPage() {
  const me = await getMe();
  if (!me) redirect('/giris?kayit=1&next=/kayit');
  const { t, locale } = await getT();
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
        <header className="flex flex-col gap-1">
          <h1 className="ui-title">{t('signup.title')}</h1>
          <p className="ui-text-muted">{t('signup.intro')}</p>
          <p className="ui-caption">{t('signup.signedInAs', { name: me.user.fullName, phone: me.user.phone })}</p>
        </header>
        <Card>
          <SignupForm locale={locale} />
        </Card>
      </main>
    </ThemeRoot>
  );
}
