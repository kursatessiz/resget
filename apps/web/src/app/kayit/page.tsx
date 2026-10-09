import { redirect } from 'next/navigation';
import { PartnerCodeSchema } from '@resget/shared';
import type { PartnerInviteDTO } from '@resget/shared';
import { SignupForm } from '@/components/SignupForm';
import { ThemeRoot } from '@/components/ThemeRoot';
import { Card } from '@/components/ui';
import { getMe } from '@/lib/api-server';
import { getT } from '@/lib/i18n';
import { apiInternalBaseUrl, visitorHeaders } from '@/lib/server-env';

/** Restaurant self sign-up: the phone that signs in becomes the owner (docs/PLATFORM_YONETIMI.md). */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ davet?: string | string[] }> }) {
  // An invite link from another restaurant (docs/RESTORAN_TAVSIYE.md) survives the sign-in detour.
  const raw = (await searchParams).davet;
  const code = typeof raw === 'string' ? PartnerCodeSchema.safeParse(raw) : null;
  const partnerCode = code?.success ? code.data : null;
  const me = await getMe();
  if (!me) {
    const next = partnerCode ? `/kayit?${new URLSearchParams({ davet: partnerCode }).toString()}` : '/kayit';
    redirect(`/giris?${new URLSearchParams({ kayit: '1', next }).toString()}`);
  }
  const { t, locale } = await getT();
  let invite: PartnerInviteDTO | null = null;
  if (partnerCode) {
    const res = await fetch(`${apiInternalBaseUrl()}/public/partner-invites/${partnerCode}`, {
      headers: await visitorHeaders(),
      cache: 'no-store',
    });
    if (res.ok) invite = (await res.json()) as PartnerInviteDTO;
  }
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
        <header className="flex flex-col gap-1">
          <h1 className="ui-title">{t('signup.title')}</h1>
          <p className="ui-text-muted">{t('signup.intro')}</p>
          <p className="ui-caption">{t('signup.signedInAs', { name: me.user.fullName, phone: me.user.phone })}</p>
        </header>
        {invite && (
          <p className="pui-alert pui-success" data-partner-invite>
            {t('partnerReferrals.signup.invited', { restaurant: invite.restaurantName, days: invite.refereeBonusDays })}
          </p>
        )}
        <Card>
          <SignupForm locale={locale} partnerCode={invite ? partnerCode : null} />
        </Card>
      </main>
    </ThemeRoot>
  );
}
