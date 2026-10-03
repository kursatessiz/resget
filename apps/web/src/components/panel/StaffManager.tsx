'use client';

import { useCallback, useEffect, useState } from 'react';
import type { InviteDTO, StaffMemberDTO, StaffOverviewDTO, Translate } from '@resget/shared';
import { Badge, Button, Card, LinkButton, SelectField, TextField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUS_TONE: Record<string, UiTone> = { ACTIVE: 'success', PASSIVE: 'muted', INVITED: 'warn' };

export function roleLabel(t: Translate, templateKey: string | null, name: string): string {
  return templateKey ? t(`roles.default.${templateKey}`) : name;
}

/** Team members, pending invites and the invite form (docs/PERSONEL.md). */
export function StaffManager({
  restaurantId,
  slug,
  locale,
  ownMembershipId,
  canManageRoles,
}: {
  restaurantId: string;
  slug: string;
  locale: string;
  ownMembershipId: string;
  canManageRoles: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/staff`;
  const [data, setData] = useState<StaffOverviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [roleId, setRoleId] = useState('');
  const [channel, setChannel] = useState<'SHOWN' | 'SMS'>('SHOWN');
  const [qrOpen, setQrOpen] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    bffJson<StaffOverviewDTO>(base)
      .then((overview) => {
        if (cancelled) return;
        setData(overview);
        setRoleId((current) => current || overview.roles.find((r) => !r.isOwner)?.id || '');
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [base, fail]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const invite = () =>
    run(async () => {
      const created = await bffJson<InviteDTO>(`${base}/invites`, {
        method: 'POST',
        body: JSON.stringify({ fullName: fullName.trim(), phone: phone.trim(), roleTemplateId: roleId, channel }),
      });
      setData((d) => d && { ...d, invites: [created, ...d.invites.filter((i) => i.phone !== created.phone)] });
      setFullName('');
      setPhone('');
      if (created.smsAccepted === true) setNotice(t('staff.invites.smsSent'));
      if (created.smsAccepted === false) setNotice(t('staff.invites.smsFailed'));
      if (channel === 'SHOWN') setQrOpen(created.id);
    });

  const revoke = (id: string) =>
    run(async () => {
      await bffJson<void>(`${base}/invites/${id}`, { method: 'DELETE' });
      setData((d) => d && { ...d, invites: d.invites.filter((i) => i.id !== id) });
    });

  const patchMember = (member: StaffMemberDTO, body: Record<string, unknown>) =>
    run(async () => {
      const updated = await bffJson<StaffMemberDTO>(`${base}/members/${member.membershipId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setData(
        (d) => d && { ...d, members: d.members.map((m) => (m.membershipId === updated.membershipId ? updated : m)) },
      );
    });

  const toggleAccess = (member: StaffMemberDTO) => {
    if (member.status === 'ACTIVE' && !window.confirm(t('staff.members.confirmDeactivate'))) return;
    void patchMember(member, { status: member.status === 'ACTIVE' ? 'PASSIVE' : 'ACTIVE' });
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setNotice(t('staff.invites.copied'));
    } catch {
      setNotice(url);
    }
  };

  if (!data) {
    return (
      <>
        <h1 className="ui-title">{t('staff.title')}</h1>
        <p className="ui-text-muted">{error ?? t('common.loading')}</p>
      </>
    );
  }

  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const assignableRoles = data.roles.filter((r) => !r.isOwner);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="ui-title">{t('staff.title')}</h1>
          <p className="ui-text-muted">{t('staff.intro')}</p>
        </div>
        {canManageRoles && (
          <LinkButton href={`/panel/${slug}/personel/roller`} variant="outline" tone="muted">
            {t('staff.roles.manage')}
          </LinkButton>
        )}
      </header>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      {notice && <p className="ui-caption">{notice}</p>}

      <Card title={t('staff.invite.title')} aria-label={t('staff.invite.title')}>
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void invite();
          }}
        >
          <TextField
            id="invite-name"
            label={t('staff.invite.name')}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
            required
          />
          <TextField
            id="invite-phone"
            label={t('staff.invite.phone')}
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <SelectField
            id="invite-role"
            label={t('staff.invite.role')}
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
          >
            {assignableRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {roleLabel(t, role.templateKey, role.name)}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="invite-channel"
            label={t('staff.invite.channel')}
            value={channel}
            onChange={(e) => setChannel(e.target.value as 'SHOWN' | 'SMS')}
          >
            <option value="SHOWN">{t('staff.invite.channel.SHOWN')}</option>
            <option value="SMS">{t('staff.invite.channel.SMS')}</option>
          </SelectField>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy || !roleId}>
              {t('staff.invite.send')}
            </Button>
          </div>
        </form>
      </Card>

      <Card title={t('staff.invites.title')} aria-label={t('staff.invites.title')}>
        {data.invites.length === 0 && <p className="ui-text-muted">{t('staff.invites.empty')}</p>}
        <ul className="ui-divide">
          {data.invites.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 py-3" data-invite-phone={item.phone}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="ui-heading">{item.fullName}</span>
                  <span className="ui-text-muted">{item.phone}</span>
                  <Badge>{roleLabel(t, item.roleTemplateKey, item.roleName)}</Badge>
                </span>
                <span className="ui-caption">
                  {t('staff.invites.expiresAt', { date: dateFormat.format(new Date(item.expiresAt)) })}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button variant="outline" tone="muted" onClick={() => void copy(item.url)}>
                  {t('staff.invites.copyLink')}
                </Button>
                <Button variant="outline" tone="muted" onClick={() => setQrOpen(qrOpen === item.id ? null : item.id)}>
                  {qrOpen === item.id ? t('staff.invites.hideQr') : t('staff.invites.showQr')}
                </Button>
                <Button variant="link" tone="error" disabled={busy} onClick={() => revoke(item.id)}>
                  {t('staff.invites.revoke')}
                </Button>
              </div>
              {qrOpen === item.id && (
                <figure className="flex flex-col gap-2">
                  <img
                    src={`/api/bff/${base}/invites/${item.id}/qr.png`}
                    alt={t('staff.invites.qrAlt', { name: item.fullName })}
                    width={256}
                    height={256}
                  />
                  <figcaption className="ui-caption">{t('staff.invites.scanHint')}</figcaption>
                  <a className="ui-caption" href={item.url}>
                    {item.url}
                  </a>
                </figure>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t('staff.members.title')} aria-label={t('staff.members.title')}>
        {data.members.length === 0 && <p className="ui-text-muted">{t('staff.members.empty')}</p>}
        <ul className="ui-divide">
          {data.members.map((member) => {
            const locked = member.isOwner || member.membershipId === ownMembershipId;
            return (
              <li key={member.membershipId} className="flex flex-col gap-2 py-3" data-member-phone={member.phone}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="ui-heading">{member.fullName}</span>
                    <span className="ui-text-muted">{member.phone}</span>
                    {member.isOwner && <Badge tone="theme">{t('staff.members.owner')}</Badge>}
                    <Badge tone={STATUS_TONE[member.status] ?? 'muted'}>{t(`staff.status.${member.status}`)}</Badge>
                  </span>
                  {member.joinedAt && (
                    <span className="ui-caption">
                      {t('staff.members.joinedAt', { date: dateFormat.format(new Date(member.joinedAt)) })}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  {locked ? (
                    <Badge>{roleLabel(t, member.roleTemplateKey, member.roleName)}</Badge>
                  ) : (
                    <>
                      <SelectField
                        id={`role-${member.membershipId}`}
                        label={t('staff.members.role')}
                        value={member.roleTemplateId}
                        disabled={busy}
                        onChange={(e) => void patchMember(member, { roleTemplateId: e.target.value })}
                      >
                        {assignableRoles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {roleLabel(t, role.templateKey, role.name)}
                          </option>
                        ))}
                      </SelectField>
                      <Button
                        variant="outline"
                        tone={member.status === 'ACTIVE' ? 'warn' : 'success'}
                        disabled={busy}
                        onClick={() => toggleAccess(member)}
                      >
                        {member.status === 'ACTIVE' ? t('staff.members.deactivate') : t('staff.members.activate')}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
