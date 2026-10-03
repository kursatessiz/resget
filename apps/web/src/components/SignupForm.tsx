'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SIGNUP_COUNTRIES, slugify } from '@resget/shared';
import type { RestaurantCreatedDTO, SignupCountryCode } from '@resget/shared';
import { Button, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

export function SignupForm({ locale }: { locale: string }) {
  const t = useT(locale);
  const router = useRouter();
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [country, setCountry] = useState<SignupCountryCode>('TR');
  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [branchName, setBranchName] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const selected = SIGNUP_COUNTRIES.find((c) => c.code === country) ?? SIGNUP_COUNTRIES[0];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await bffJson<RestaurantCreatedDTO>('restaurants', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          ...(slug.trim() ? { slug: slug.trim() } : {}),
          countryCode: selected.code,
          currency: selected.currency,
          timezone: selected.timezone,
          defaultLocale: selected.locale,
          ...(legalName.trim() ? { legalName: legalName.trim() } : {}),
          ...(taxId.trim() ? { taxId: taxId.trim() } : {}),
          branch: {
            ...(branchName.trim() ? { name: branchName.trim() } : {}),
            addressLine: addressLine.trim(),
            city: city.trim(),
            district: district.trim(),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
          },
        }),
      });
      setDone(true);
      router.push(`/panel/${created.slug}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset className="grid gap-3 md:grid-cols-2">
        <legend className="ui-heading">{t('signup.business.title')}</legend>
        <TextField
          id="su-name"
          label={t('signup.name')}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          maxLength={80}
          required
        />
        <TextField
          id="su-slug"
          label={t('signup.slug')}
          help={t('signup.slugHelp')}
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
          maxLength={60}
          pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
        />
        <SelectField
          id="su-country"
          label={t('signup.country')}
          value={country}
          onChange={(e) => setCountry(e.target.value as SignupCountryCode)}
        >
          {SIGNUP_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {regionNames.of(c.code) ?? c.code}
            </option>
          ))}
        </SelectField>
        <TextField
          id="su-currency"
          label={`${t('signup.currency')} / ${t('signup.timezone')}`}
          value={`${selected.currency} / ${selected.timezone}`}
          readOnly
        />
        <TextField
          id="su-legal"
          label={t('signup.legalName')}
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          maxLength={160}
        />
        <TextField
          id="su-tax"
          label={t('signup.taxId')}
          value={taxId}
          onChange={(e) => setTaxId(e.target.value)}
          maxLength={32}
        />
      </fieldset>
      <fieldset className="grid gap-3 md:grid-cols-2">
        <legend className="ui-heading">{t('signup.branch.title')}</legend>
        <TextField
          id="su-branch"
          label={t('signup.branch.name')}
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          maxLength={80}
        />
        <TextField
          id="su-phone"
          label={t('signup.branch.phone')}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <TextField
          id="su-address"
          label={t('signup.branch.addressLine')}
          value={addressLine}
          onChange={(e) => setAddressLine(e.target.value)}
          maxLength={200}
          required
          className="md:col-span-2"
        />
        <TextField
          id="su-city"
          label={t('signup.branch.city')}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          maxLength={80}
          required
        />
        <TextField
          id="su-district"
          label={t('signup.branch.district')}
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          maxLength={80}
          required
        />
      </fieldset>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      <p className="ui-caption">{t('signup.terms')}</p>
      {done ? (
        <p className="ui-text-muted">{t('signup.success')}</p>
      ) : (
        <Button type="submit" disabled={busy} block>
          {busy ? t('signup.creating') : t('signup.submit')}
        </Button>
      )}
    </form>
  );
}
