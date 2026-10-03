'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { AdminRestaurantPageDTO, RestaurantCreatedDTO, SignupCountryCode } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** Restaurant list of the console with search, listing filter and a create form for onboarding by phone. */
export function AdminRestaurants({ locale }: { locale: string }) {
  const t = useT(locale);
  const [data, setData] = useState<AdminRestaurantPageDTO | null>(null);
  const [query, setQuery] = useState('');
  const [listedOnly, setListedOnly] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: '',
    ownerPhone: '',
    ownerName: '',
    country: 'TR' as SignupCountryCode,
    addressLine: '',
    city: '',
    district: '',
  });

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('query', query.trim());
    if (listedOnly) params.set('listed', 'true');
    if (pendingOnly) params.set('pending', 'true');
    setData(await bffJson<AdminRestaurantPageDTO>(`admin/restaurants?${params.toString()}`));
  }, [query, listedOnly, pendingOnly]);

  useEffect(() => {
    const handle = setTimeout(() => {
      load().catch(fail);
    }, 250);
    return () => clearTimeout(handle);
  }, [load, fail]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const country = SIGNUP_COUNTRIES.find((c) => c.code === form.country) ?? SIGNUP_COUNTRIES[0];
      await bffJson<RestaurantCreatedDTO>('admin/restaurants', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          ownerPhone: form.ownerPhone.trim(),
          ownerName: form.ownerName.trim(),
          countryCode: country.code,
          currency: country.currency,
          timezone: country.timezone,
          defaultLocale: country.locale,
          branch: { addressLine: form.addressLine.trim(), city: form.city.trim(), district: form.district.trim() },
        }),
      });
      setAdding(false);
      setForm({ name: '', ownerPhone: '', ownerName: '', country: 'TR', addressLine: '', city: '', district: '' });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
  const count = new Intl.NumberFormat(locale);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="ui-title">{t('admin.restaurants.title')}</h1>
        <Button
          variant={adding ? 'outline' : 'solid'}
          tone={adding ? 'muted' : 'theme'}
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? t('common.cancel') : t('admin.restaurants.add')}
        </Button>
      </header>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      {adding && (
        <Card title={t('admin.restaurants.add')} aria-label={t('admin.restaurants.add')}>
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <TextField
              id="ar-name"
              label={t('signup.name')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <SelectField
              id="ar-country"
              label={t('signup.country')}
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value as SignupCountryCode })}
            >
              {SIGNUP_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {regionNames.of(c.code) ?? c.code}
                </option>
              ))}
            </SelectField>
            <TextField
              id="ar-owner-phone"
              label={t('admin.restaurants.ownerPhone')}
              type="tel"
              value={form.ownerPhone}
              onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })}
              required
            />
            <TextField
              id="ar-owner-name"
              label={t('admin.restaurants.ownerName')}
              value={form.ownerName}
              onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
              required
            />
            <TextField
              id="ar-address"
              label={t('signup.branch.addressLine')}
              value={form.addressLine}
              onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
              required
              className="md:col-span-2"
            />
            <TextField
              id="ar-city"
              label={t('signup.branch.city')}
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              required
            />
            <TextField
              id="ar-district"
              label={t('signup.branch.district')}
              value={form.district}
              onChange={(e) => setForm({ ...form, district: e.target.value })}
              required
            />
            <div className="md:col-span-2">
              <Button type="submit" disabled={busy}>
                {t('signup.submit')}
              </Button>
            </div>
          </form>
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            id="ar-search"
            label={t('admin.restaurants.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              className="pui-checkbox"
              checked={listedOnly}
              onChange={(e) => setListedOnly(e.target.checked)}
            />
            <span>{t('admin.restaurants.listedOnly')}</span>
          </label>
          <label className="flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              className="pui-checkbox"
              checked={pendingOnly}
              onChange={(e) => setPendingOnly(e.target.checked)}
            />
            <span>{t('admin.restaurants.pendingOnly')}</span>
          </label>
          {data && <span className="ui-caption pb-2">{t('admin.restaurants.count', { count: data.total })}</span>}
        </div>
        {!data ? (
          <p className="ui-text-muted">{t('common.loading')}</p>
        ) : data.items.length === 0 ? (
          <p className="ui-text-muted">{t('admin.restaurants.empty')}</p>
        ) : (
          <ul className="ui-divide">
            {data.items.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
                data-restaurant-slug={r.slug}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="ui-heading">{r.name}</span>
                  <span className="ui-text-muted">{r.slug}</span>
                  {r.city && (
                    <span className="ui-caption">
                      {r.city} / {r.district}
                    </span>
                  )}
                  <Badge tone={r.isListed ? 'success' : 'muted'}>
                    {r.isListed ? t('admin.restaurant.listed') : t('admin.restaurant.notListed')}
                  </Badge>
                  {!r.isActive && <Badge tone="error">{t('admin.restaurant.inactive')}</Badge>}
                  {!r.isListed && r.listingRequestedAt && !r.listingReviewedAt && (
                    <Badge tone="warn">
                      {t('admin.restaurant.listingRequested', {
                        date: new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(
                          new Date(r.listingRequestedAt),
                        ),
                      })}
                    </Badge>
                  )}
                  {r.plan && <Badge>{t(`plans.${r.plan.code}.name`)}</Badge>}
                  <span className="ui-caption">
                    {t('admin.restaurant.orders7d', { count: count.format(r.ordersLast7Days) })}
                  </span>
                </span>
                <Link href={`/admin/restoranlar/${r.id}`} className="pui-btn pui-outline pui-muted">
                  {t('admin.restaurants.open')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
