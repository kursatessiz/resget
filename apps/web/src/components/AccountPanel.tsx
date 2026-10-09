'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { CustomerAccountDTO, CustomerAddressDTO, PersonalDataExportDTO } from '@resget/shared';
import { Badge, Button, Card, LinkButton, TextField } from '@/components/ui';
import { SignOutButton } from '@/components/SignOutButton';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const EMPTY_ADDRESS = { label: '', addressLine: '', city: '', district: '', note: '' };

/** Profile, saved addresses and recent orders of the signed-in customer. */
export function AccountPanel({ locale }: { locale: string }) {
  const t = useT(locale);
  const [data, setData] = useState<CustomerAccountDTO | null>(null);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState(EMPTY_ADDRESS);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const signOutForm = useRef<HTMLFormElement>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const apply = useCallback((dto: CustomerAccountDTO) => {
    setData(dto);
    setName(dto.user.fullName);
  }, []);

  useEffect(() => {
    bffJson<CustomerAccountDTO>('me/account').then(apply).catch(fail);
  }, [apply, fail]);

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await run();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const withAddresses = (addresses: CustomerAddressDTO[]) => setData((d) => (d ? { ...d, addresses } : d));

  const saveProfile = () =>
    act(async () => {
      apply(
        await bffJson<CustomerAccountDTO>('me/profile', {
          method: 'PATCH',
          body: JSON.stringify({ fullName: name.trim() }),
        }),
      );
      setNotice(t('common.saved'));
    });
  const addAddress = () =>
    act(async () => {
      withAddresses(
        await bffJson<CustomerAddressDTO[]>('me/addresses', {
          method: 'POST',
          body: JSON.stringify({
            label: draft.label.trim(),
            addressLine: draft.addressLine.trim(),
            city: draft.city.trim(),
            district: draft.district.trim(),
            ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
          }),
        }),
      );
      setDraft(EMPTY_ADDRESS);
      setNotice(t('account.addresses.saved'));
    });
  const makeDefault = (id: string) =>
    act(async () => {
      withAddresses(
        await bffJson<CustomerAddressDTO[]>(`me/addresses/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isDefault: true }),
        }),
      );
    });
  const remove = (id: string) =>
    act(async () => {
      withAddresses(await bffJson<CustomerAddressDTO[]>(`me/addresses/${id}`, { method: 'DELETE' }));
    });

  /** The person's data as a JSON file (docs/KISISEL_VERI.md); built in the browser, nothing is stored. */
  const downloadData = () =>
    act(async () => {
      const data = await bffJson<PersonalDataExportDTO>('me/data-export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'personal-data.json';
      link.click();
      URL.revokeObjectURL(url);
    });
  const deleteAccount = () =>
    act(async () => {
      await bffJson<void>('me/account/delete', { method: 'POST', body: JSON.stringify({ confirm: true }) });
      // The session cookies go with the account; the logout handler clears them and sends the visitor home.
      signOutForm.current?.submit();
    });

  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="ui-title">{t('account.title')}</h1>
          <p className="ui-text-muted">{t('account.intro')}</p>
        </div>
        <SignOutButton label={t('account.signOut')} />
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && <p className="pui-alert pui-success">{notice}</p>}

      {data && (
        <>
          <Card title={t('account.profile.title')}>
            <p className="ui-caption">{t('account.profile.phone', { phone: data.user.phone })}</p>
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <TextField
                label={t('account.profile.name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
              <Button onClick={saveProfile} disabled={busy || name.trim().length < 2}>
                {t('account.profile.save')}
              </Button>
            </div>
          </Card>

          <Card title={t('account.addresses.title')}>
            {data.addresses.length === 0 && <p className="ui-text-muted">{t('account.addresses.empty')}</p>}
            {data.addresses.length > 0 && (
              <ul className="flex flex-col gap-2">
                {data.addresses.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2" aria-label={a.label}>
                    <span>
                      <span className="ui-heading">{a.label}</span>{' '}
                      <span className="ui-caption">
                        {a.addressLine}, {a.district} / {a.city}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {a.isDefault ? (
                        <Badge tone="success">{t('account.addresses.default')}</Badge>
                      ) : (
                        <Button variant="outline" tone="muted" onClick={() => makeDefault(a.id)} disabled={busy}>
                          {t('account.addresses.makeDefault')}
                        </Button>
                      )}
                      <Button variant="outline" tone="error" onClick={() => remove(a.id)} disabled={busy}>
                        {t('account.addresses.remove')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                label={t('account.addresses.label')}
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
              <TextField
                label={t('shop.address.line')}
                value={draft.addressLine}
                onChange={(e) => setDraft({ ...draft, addressLine: e.target.value })}
              />
              <TextField
                label={t('shop.address.city')}
                value={draft.city}
                onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              />
              <TextField
                label={t('shop.address.district')}
                value={draft.district}
                onChange={(e) => setDraft({ ...draft, district: e.target.value })}
              />
              <TextField
                label={t('shop.address.note')}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                className="md:col-span-2"
              />
            </div>
            <div>
              <Button
                onClick={addAddress}
                disabled={
                  busy ||
                  !draft.label.trim() ||
                  draft.addressLine.trim().length < 5 ||
                  !draft.city.trim() ||
                  !draft.district.trim()
                }
              >
                {t('account.addresses.add')}
              </Button>
            </div>
          </Card>

          <Card title={t('loyalty.account.title')}>
            {data.loyalty.length === 0 && <p className="ui-text-muted">{t('loyalty.account.empty')}</p>}
            {data.loyalty.length > 0 && (
              <ul className="flex flex-col gap-2">
                {data.loyalty.map((b) => (
                  <li key={b.restaurant.slug} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-col">
                      <span>{t('loyalty.account.line', { restaurant: b.restaurant.name, points: b.points })}</span>
                      {b.valueMinor > 0 && (
                        <span className="ui-caption">
                          {t('loyalty.account.value', {
                            amount: formatMoney({ amountMinor: b.valueMinor, currency: b.currency }, locale),
                          })}
                        </span>
                      )}
                      {b.tier && <span className="ui-caption">{t('loyalty.tiers.label', { tier: b.tier })}</span>}
                      {b.nextTier && (
                        <span className="ui-caption">
                          {t('loyalty.tiers.next', {
                            tier: b.nextTier.name,
                            amount: formatMoney(
                              { amountMinor: b.nextTier.remainingMinor, currency: b.currency },
                              locale,
                            ),
                          })}
                        </span>
                      )}
                    </span>
                    <LinkButton href={`/${b.restaurant.slug}`} variant="outline" tone="muted">
                      {t('loyalty.account.order')}
                    </LinkButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('account.orders.title')}>
            {data.orders.length === 0 && <p className="ui-text-muted">{t('account.orders.empty')}</p>}
            {data.orders.length > 0 && (
              <ul className="flex flex-col gap-2">
                {data.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span>
                        {t('account.orders.line', {
                          restaurant: o.restaurant.name,
                          code: o.shortCode,
                          total: formatMoney({ amountMinor: o.chargedToCustomerMinor, currency: o.currency }, locale),
                          date: day(o.placedAt),
                        })}
                      </span>
                      <Badge tone="muted">{t(`orders.status.${o.status}`)}</Badge>
                    </span>
                    {o.trackingUrl && (
                      <LinkButton href={o.trackingUrl} variant="outline" tone="muted">
                        {t('account.orders.track')}
                      </LinkButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('account.privacy.title')}>
            <div className="flex flex-col gap-3">
              <p className="ui-text-muted">{t('account.privacy.intro')}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" tone="muted" onClick={() => void downloadData()} disabled={busy}>
                  {t('account.privacy.download')}
                </Button>
                {!deleting && (
                  <Button variant="outline" tone="error" onClick={() => setDeleting(true)} disabled={busy}>
                    {t('account.privacy.delete')}
                  </Button>
                )}
              </div>
              {deleting && (
                <div className="flex flex-col gap-3" role="group" aria-label={t('account.privacy.deleteTitle')}>
                  <p className="ui-heading">{t('account.privacy.deleteTitle')}</p>
                  <p>{t('account.privacy.deleteErased')}</p>
                  <p className="ui-text-muted">{t('account.privacy.deleteKept')}</p>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="pui-checkbox"
                      checked={understood}
                      onChange={(e) => setUnderstood(e.target.checked)}
                    />
                    <span>{t('account.privacy.deleteConfirm')}</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button tone="error" onClick={() => void deleteAccount()} disabled={busy || !understood}>
                      {t('account.privacy.deleteNow')}
                    </Button>
                    <Button
                      variant="outline"
                      tone="muted"
                      onClick={() => {
                        setDeleting(false);
                        setUnderstood(false);
                      }}
                      disabled={busy}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
          <form ref={signOutForm} method="post" action="/api/session/logout" hidden>
            <input type="hidden" name="next" value="/" />
          </form>
        </>
      )}
    </>
  );
}
