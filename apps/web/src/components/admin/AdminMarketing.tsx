'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PLATFORM_ROLE_KEYS, SIGNUP_COUNTRIES } from '@resget/shared';
import type { PlatformAdminDTO, PlatformRoleKey } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';
import { AdminConsentPolicy } from './AdminConsentPolicy';

/**
 * Platform marketing in the console (docs/PAZARLAMA.md): set up the platform
 * tenant once, then add marketing users, change their role and switch them
 * off. The module itself is switched on under feature switches.
 */
export function AdminMarketing({ locale }: { locale: string }) {
  const t = useT(locale);
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
  const [data, setData] = useState<PlatformAdminDTO | null>(null);
  const [name, setName] = useState('');
  const [country, setCountry] = useState<string>(SIGNUP_COUNTRIES[0].code);
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<PlatformRoleKey>('marketing_editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    bffJson<PlatformAdminDTO>('admin/platform').then(setData).catch(fail);
  }, [fail]);

  const call = async (path: string, method: 'POST' | 'PATCH', body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      setData(await bffJson<PlatformAdminDTO>(path, { method, body: JSON.stringify(body) }));
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <p role="alert">{error}</p> : null;
  const selected = SIGNUP_COUNTRIES.find((c) => c.code === country) ?? SIGNUP_COUNTRIES[0];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="ui-title">{t('marketing.admin.title')}</h1>
      <p className="ui-text-muted">{t('marketing.admin.intro')}</p>
      {error && <p role="alert">{error}</p>}

      <Card title={t('marketing.admin.setup.title')} aria-label={t('marketing.admin.setup.title')}>
        {data.tenant ? (
          <div className="flex flex-col gap-3">
            <p role="status">{t('marketing.admin.setup.done', { currency: data.tenant.currency })}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={data.enabled ? 'success' : 'warn'}>
                {data.enabled ? t('marketing.admin.enabled') : t('marketing.admin.disabled')}
              </Badge>
              {data.enabled ? (
                <Link href="/pazarlama" className="pui-btn pui-link pui-theme">
                  {t('marketing.admin.open')}
                </Link>
              ) : (
                <Link href="/admin/ozellikler" className="pui-btn pui-link pui-theme">
                  {t('admin.nav.features')}
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              id="platform-name"
              label={t('marketing.admin.setup.name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <SelectField
              id="platform-country"
              label={t('marketing.admin.setup.country')}
              value={country}
              onChange={(event) => setCountry(event.target.value)}
            >
              {SIGNUP_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {regionNames.of(c.code) ?? c.code}
                </option>
              ))}
            </SelectField>
            <div className="md:col-span-2">
              <Button
                disabled={busy || name.trim().length < 2}
                onClick={() =>
                  void call('admin/platform/setup', 'POST', {
                    name: name.trim(),
                    countryCode: selected.code,
                    currency: selected.currency,
                    timezone: selected.timezone,
                    defaultLocale: selected.locale,
                  })
                }
              >
                {t('marketing.admin.setup.submit')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {data.tenant && (
        <Card title={t('marketing.admin.users.title')} aria-label={t('marketing.admin.users.title')}>
          <div className="flex flex-col gap-4">
            {data.users.length === 0 ? (
              <p className="ui-text-muted">{t('marketing.admin.users.empty')}</p>
            ) : (
              <ul className="ui-divide">
                {data.users.map((user) => (
                  <li
                    key={user.membershipId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                    data-platform-user={user.phoneMasked}
                  >
                    <span className="flex flex-col">
                      <span>{user.fullName}</span>
                      <span className="ui-caption">{user.phoneMasked}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <SelectField
                        id={`platform-role-${user.membershipId}`}
                        label={t('marketing.admin.users.role')}
                        value={user.role}
                        disabled={busy}
                        onChange={(event) =>
                          void call(`admin/platform/users/${user.membershipId}`, 'PATCH', { role: event.target.value })
                        }
                      >
                        {PLATFORM_ROLE_KEYS.map((key) => (
                          <option key={key} value={key}>
                            {t(`marketing.role.${key}`)}
                          </option>
                        ))}
                      </SelectField>
                      <Badge tone={user.active ? 'success' : 'muted'}>
                        {user.active ? t('marketing.admin.users.active') : t('marketing.admin.users.passive')}
                      </Badge>
                      <Button
                        variant="outline"
                        tone={user.active ? 'error' : 'muted'}
                        disabled={busy}
                        onClick={() =>
                          void call(`admin/platform/users/${user.membershipId}`, 'PATCH', { active: !user.active })
                        }
                      >
                        {user.active ? t('marketing.admin.users.deactivate') : t('marketing.admin.users.activate')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-3 md:grid-cols-3">
              <TextField
                id="platform-user-phone"
                label={t('marketing.admin.users.phone')}
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
              <TextField
                id="platform-user-name"
                label={t('marketing.admin.users.name')}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
              <SelectField
                id="platform-user-role"
                label={t('marketing.admin.users.role')}
                value={role}
                onChange={(event) => setRole(event.target.value as PlatformRoleKey)}
              >
                {PLATFORM_ROLE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {t(`marketing.role.${key}`)}
                  </option>
                ))}
              </SelectField>
            </div>
            <p className="ui-caption">{t('marketing.admin.users.hint')}</p>
            <div>
              <Button
                disabled={busy || phone.trim() === '' || fullName.trim().length < 2}
                onClick={async () => {
                  if (
                    await call('admin/platform/users', 'POST', { phone: phone.trim(), fullName: fullName.trim(), role })
                  ) {
                    setPhone('');
                    setFullName('');
                  }
                }}
              >
                {t('marketing.admin.users.invite')}
              </Button>
            </div>
          </div>
        </Card>
      )}
      {data.tenant && <AdminConsentPolicy restaurantId={data.tenant.id} locale={locale} />}
    </div>
  );
}
