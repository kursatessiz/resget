'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BUNDLED_LANGUAGES, DEFAULT_DISPATCH_SETTINGS, majorAmountText, parseMajorAmount } from '@resget/shared';
import type { DeliveryFeePolicy, DispatchSettings, RestaurantSettingsDTO } from '@resget/shared';
import { Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

type Section = 'business' | 'brand' | 'delivery' | 'dispatch';
type FeeMode = 'NONE' | DeliveryFeePolicy['mode'];
type DeliveryModeValue = RestaurantSettingsDTO['deliveryMode'];

const HEX = /^#[0-9a-fA-F]{6}$/;
const DELIVERY_MODES: DeliveryModeValue[] = ['RESTAURANT_COURIER', 'THIRD_PARTY_API', 'NONE'];
const FEE_MODES: FeeMode[] = ['NONE', 'PASS_THROUGH', 'FIXED', 'FREE_ABOVE'];
const DISPATCH_FIELDS: { key: keyof DispatchSettings; step: string }[] = [
  { key: 'avgSpeedKmh', step: '1' },
  { key: 'detourFactor', step: '0.05' },
  { key: 'stopServiceMinutes', step: '1' },
  { key: 'arrivalRadiusMeters', step: '10' },
  { key: 'maxStopsPerTrip', step: '1' },
  { key: 'locationBroadcastSeconds', step: '1' },
  { key: 'defaultPrepMinutes', step: '5' },
  { key: 'acceptTimeoutMinutes', step: '1' },
];

function toDraft(settings: DispatchSettings): Record<keyof DispatchSettings, string> {
  return Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, String(value)])) as Record<
    keyof DispatchSettings,
    string
  >;
}

/** Owner settings in four sections, each saved on its own; platform fields are shown read-only. */
export function SettingsForm({
  restaurantId,
  locale,
  canManage,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
}) {
  const t = useT(locale);
  const router = useRouter();
  const path = `restaurants/${restaurantId}`;
  const [data, setData] = useState<RestaurantSettingsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Section | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [defaultLocale, setDefaultLocale] = useState('tr');
  const [logoUrl, setLogoUrl] = useState('');
  const [themePrimary, setThemePrimary] = useState('#0092CD');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryModeValue>('RESTAURANT_COURIER');
  const [feeMode, setFeeMode] = useState<FeeMode>('NONE');
  const [roundUp, setRoundUp] = useState('');
  const [fee, setFee] = useState('');
  const [threshold, setThreshold] = useState('');
  const [dispatch, setDispatch] = useState(() => toDraft(DEFAULT_DISPATCH_SETTINGS));

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    bffJson<RestaurantSettingsDTO>(path)
      .then((dto) => {
        if (cancelled) return;
        setData(dto);
        setName(dto.name);
        setLegalName(dto.legalName ?? '');
        setTaxId(dto.taxId ?? '');
        setDefaultLocale(dto.defaultLocale);
        setLogoUrl(dto.logoUrl ?? '');
        setThemePrimary(dto.themePrimary);
        setDeliveryMode(dto.deliveryMode);
        const policy = dto.deliveryFeePolicy;
        setFeeMode(policy?.mode ?? 'NONE');
        if (policy?.mode === 'PASS_THROUGH' && policy.roundUpToMinor) {
          setRoundUp(majorAmountText(policy.roundUpToMinor, dto.currency));
        }
        if (policy?.mode === 'FIXED' || policy?.mode === 'FREE_ABOVE') {
          setFee(majorAmountText(policy.feeMinor, dto.currency));
        }
        if (policy?.mode === 'FREE_ABOVE') setThreshold(majorAmountText(policy.thresholdMinor, dto.currency));
        setDispatch(toDraft(dto.dispatchSettings));
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [path, fail]);

  const save = async (section: Section, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const dto = await bffJson<RestaurantSettingsDTO>(path, { method: 'PATCH', body: JSON.stringify(body) });
      setData(dto);
      setSaved(section);
      if (section === 'business' || section === 'brand') router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <>
        <h1 className="ui-title">{t('settings.title')}</h1>
        <p className="ui-text-muted">{error ?? t('common.loading')}</p>
      </>
    );
  }

  const currency = data.currency;
  const amount = (text: string) => parseMajorAmount(text, currency);
  const invalidAmount = () => setError(t('menu.manage.invalidPrice'));

  const saveBusiness = () =>
    save('business', {
      name: name.trim(),
      legalName: legalName.trim() || null,
      taxId: taxId.trim() || null,
      defaultLocale,
    });

  const saveBrand = () => {
    if (!HEX.test(themePrimary)) {
      setError(t('settings.invalidColor'));
      return;
    }
    void save('brand', { logoUrl: logoUrl.trim() || null, themePrimary });
  };

  const saveDelivery = () => {
    let policy: DeliveryFeePolicy | null = null;
    if (feeMode === 'PASS_THROUGH') {
      const step = roundUp.trim() ? amount(roundUp) : undefined;
      if (step === null || (step !== undefined && step <= 0)) return invalidAmount();
      policy = step ? { mode: 'PASS_THROUGH', roundUpToMinor: step } : { mode: 'PASS_THROUGH' };
    } else if (feeMode === 'FIXED') {
      const feeMinor = amount(fee);
      if (feeMinor === null) return invalidAmount();
      policy = { mode: 'FIXED', feeMinor };
    } else if (feeMode === 'FREE_ABOVE') {
      const feeMinor = amount(fee);
      const thresholdMinor = amount(threshold);
      if (feeMinor === null || thresholdMinor === null) return invalidAmount();
      policy = { mode: 'FREE_ABOVE', thresholdMinor, feeMinor };
    }
    void save('delivery', { deliveryMode, deliveryFeePolicy: policy });
  };

  const saveDispatch = () => {
    const settings = Object.fromEntries(
      DISPATCH_FIELDS.map(({ key }) => [key, Number(dispatch[key].replace(',', '.'))]),
    );
    void save('dispatch', { dispatchSettings: settings });
  };

  const footer = (section: Section, onSave: () => void) => (
    <div className="flex flex-wrap items-center gap-3">
      {canManage && (
        <Button onClick={onSave} disabled={busy}>
          {t('common.save')}
        </Button>
      )}
      {saved === section && <span className="ui-caption">{t('common.saved')}</span>}
    </div>
  );

  return (
    <>
      <h1 className="ui-title">{t('settings.title')}</h1>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}

      <Card title={t('settings.business.title')} aria-label={t('settings.business.title')}>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField
            id="s-name"
            label={t('settings.business.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            disabled={!canManage}
          />
          <TextField
            id="s-legal"
            label={t('settings.business.legalName')}
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            maxLength={160}
            disabled={!canManage}
          />
          <TextField
            id="s-tax"
            label={t('settings.business.taxId')}
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            maxLength={32}
            disabled={!canManage}
          />
          <SelectField
            id="s-locale"
            label={t('settings.business.defaultLocale')}
            value={defaultLocale}
            onChange={(e) => setDefaultLocale(e.target.value)}
            disabled={!canManage}
          >
            {BUNDLED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </SelectField>
        </div>
        {footer('business', () => void saveBusiness())}
      </Card>

      <Card title={t('settings.brand.title')} aria-label={t('settings.brand.title')}>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField
            id="s-logo"
            label={t('settings.brand.logoUrl')}
            help={t('settings.brand.logoHelp')}
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            type="url"
            disabled={!canManage}
          />
          <div className="flex items-end gap-2">
            <TextField
              id="s-color"
              label={t('settings.brand.primary')}
              help={t('settings.brand.primaryHelp')}
              value={themePrimary}
              onChange={(e) => setThemePrimary(e.target.value)}
              maxLength={7}
              disabled={!canManage}
            />
            <input
              type="color"
              className="pui-input"
              aria-label={t('settings.brand.primary')}
              value={HEX.test(themePrimary) ? themePrimary : '#000000'}
              onChange={(e) => setThemePrimary(e.target.value)}
              disabled={!canManage}
            />
          </div>
        </div>
        {footer('brand', saveBrand)}
      </Card>

      <Card title={t('settings.delivery.title')} aria-label={t('settings.delivery.title')}>
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField
            id="s-delivery"
            label={t('settings.delivery.mode')}
            value={deliveryMode}
            onChange={(e) => setDeliveryMode(e.target.value as DeliveryModeValue)}
            disabled={!canManage}
          >
            {DELIVERY_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`settings.delivery.mode.${mode}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="s-fee-mode"
            label={t('settings.delivery.feePolicy')}
            value={feeMode}
            onChange={(e) => setFeeMode(e.target.value as FeeMode)}
            disabled={!canManage}
          >
            {FEE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`settings.delivery.feePolicy.${mode}`)}
              </option>
            ))}
          </SelectField>
          {feeMode === 'PASS_THROUGH' && (
            <TextField
              id="s-roundup"
              label={t('settings.delivery.roundUp', { currency })}
              value={roundUp}
              onChange={(e) => setRoundUp(e.target.value)}
              inputMode="decimal"
              disabled={!canManage}
            />
          )}
          {(feeMode === 'FIXED' || feeMode === 'FREE_ABOVE') && (
            <TextField
              id="s-fee"
              label={t('settings.delivery.fee', { currency })}
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              inputMode="decimal"
              disabled={!canManage}
            />
          )}
          {feeMode === 'FREE_ABOVE' && (
            <TextField
              id="s-threshold"
              label={t('settings.delivery.threshold', { currency })}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="decimal"
              disabled={!canManage}
            />
          )}
        </div>
        <p className="ui-caption">{t('settings.delivery.feeNote')}</p>
        {footer('delivery', saveDelivery)}
      </Card>

      <Card title={t('settings.dispatch.title')} aria-label={t('settings.dispatch.title')}>
        <p className="ui-caption">{t('settings.dispatch.intro')}</p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {DISPATCH_FIELDS.map(({ key, step }) => (
            <TextField
              key={key}
              id={`s-dispatch-${key}`}
              label={t(`settings.dispatch.${key}`)}
              type="number"
              step={step}
              value={dispatch[key]}
              onChange={(e) => setDispatch((d) => ({ ...d, [key]: e.target.value }))}
              disabled={!canManage}
            />
          ))}
        </div>
        {footer('dispatch', saveDispatch)}
      </Card>

      <Card title={t('settings.platform.title')} aria-label={t('settings.platform.title')}>
        <ul className="ui-divide">
          <li className="py-2">{t('settings.platform.commission', { percent: data.commissionBps / 100 })}</li>
          <li className="py-2">{t('settings.platform.currency', { currency })}</li>
          <li className="py-2">{t('settings.platform.country', { country: data.countryCode })}</li>
          <li className="py-2">{t('settings.platform.plan', { plan: t(`panel.plan.${data.effectivePlan}`) })}</li>
          <li className="py-2">{data.isListed ? t('settings.platform.listed') : t('settings.platform.notListed')}</li>
        </ul>
      </Card>
    </>
  );
}
