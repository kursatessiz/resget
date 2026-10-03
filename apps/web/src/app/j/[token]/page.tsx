import { InviteTokenSchema } from '@resget/shared';
import type { PublicInviteDTO } from '@resget/shared';
import { AcceptInvite } from '@/components/AcceptInvite';
import { ThemeRoot } from '@/components/ThemeRoot';
import { Card, LinkButton } from '@/components/ui';
import { apiFetch, getMe } from '@/lib/api-server';
import { getT } from '@/lib/i18n';

/**
 * The staff invite link (docs/PERSONEL.md). Without a session it hands over
 * to the sign-in with the token, which accepts the invite once the invited
 * phone is verified; with a session it offers a one-click accept.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const { t, locale } = await getT();
  const token = InviteTokenSchema.safeParse(raw).success ? raw : null;
  const res = token ? await apiFetch(`/public/invites/${token}`) : null;
  const invite = res && res.ok ? ((await res.json()) as PublicInviteDTO) : null;
  const me = invite ? await getMe() : null;

  if (!invite || !token) {
    return (
      <ThemeRoot tenantTheme={null}>
        <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
          <h1 className="ui-title">{t('staff.join.title')}</h1>
          <p className="ui-text-muted">{t('staff.join.invalid')}</p>
        </main>
      </ThemeRoot>
    );
  }

  const roleLabel = invite.roleTemplateKey ? t(`roles.default.${invite.roleTemplateKey}`) : invite.roleName;
  const expires = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(
    new Date(invite.expiresAt),
  );
  const next = `/panel/${invite.restaurantSlug}`;
  return (
    <ThemeRoot tenantTheme={{ themePrimary: invite.themePrimary, logoUrl: invite.logoUrl }}>
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
        <header className="flex flex-col gap-1">
          <h1 className="ui-title">{t('staff.join.title')}</h1>
          <p className="ui-lead">{t('staff.join.intro', { restaurant: invite.restaurantName, role: roleLabel })}</p>
        </header>
        <Card>
          <p>{t('staff.join.for', { name: invite.fullName, phone: invite.phoneMasked })}</p>
          <p className="ui-caption">{t('staff.join.expiresAt', { date: expires })}</p>
          {me ? (
            <AcceptInvite token={token} locale={locale} phone={me.user.phone} next={next} />
          ) : (
            <LinkButton href={`/giris?davet=${token}&next=${encodeURIComponent(next)}`} block>
              {t('staff.join.signIn')}
            </LinkButton>
          )}
        </Card>
      </main>
    </ThemeRoot>
  );
}
