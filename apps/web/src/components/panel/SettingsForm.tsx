'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BUNDLED_LANGUAGES, DEFAULT_DISPATCH_SETTINGS, majorAmountText, parseMajorAmount } from '@resget/shared';
import type { CustomDomainDTO, DeliveryFeePolicy, DispatchSettings, RestaurantSettingsDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson, bffUpload } from '@/lib/client-api';
import { useT } from '@/lib/use-t';
import { panelPlanLabel } from '@/lib/plans';

type Section = 'business' | 'brand' | 'delivery' | 'dispatch' | 'platform' | 'domain';
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
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoNotice, setLogoNotice] = useState<string | null>(null);
  const [themePrimary, setThemePrimary] = useState('#0092CD');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryModeValue>('RESTAURANT_COURIER');
  const [feeMode, setFeeMode] = useState<FeeMode>('NONE');
  const [roundUp, setRoundUp] = useState('');
  const [fee, setFee] = useState('');
  const [threshold, setThreshold] = useState('');
  const [dispatch, setDispatch] = useState(() => toDraft(DEFAULT_DISPATCH_SETTINGS));
  const [domainStatus, setDomainStatus] = useState<CustomDomainDTO | null>(null);
  const [domainDraft, setDomainDraft] = useState('');
  const [domainNotice, setDomainNotice] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    bffJson<CustomDomainDTO>(`${path}/domain`)
      .then((status) => {
        if (cancelled) return;
        setDomainStatus(status);
        setDomainDraft(status.domain ?? '');
      })
      .catch(fail);
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

  const applyLogo = (dto: RestaurantSettingsDTO) => {
    setData(dto);
    setLogoUrl(dto.logoUrl ?? '');
    setLogoFile(null);
    router.refresh();
  };

  const uploadLogo = async () => {
    if (!logoFile) return;
    setBusy(true);
    setError(null);
    setLogoNotice(null);
    try {
      const form = new FormData();
      form.append('file', logoFile);
      applyLogo(await bffUpload<RestaurantSettingsDTO>(`${path}/logo`, form));
      setLogoNotice(t('settings.brand.uploaded'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const domainAction = async (run: () => Promise<CustomDomainDTO>, notice: (status: CustomDomainDTO) => string) => {
    setBusy(true);
    setError(null);
    setDomainNotice(null);
    try {
      const status = await run();
      setDomainStatus(status);
      setDomainDraft(status.domain ?? '');
      setDomainNotice(notice(status));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const saveDomain = () =>
    domainAction(
      () =>
        bffJson<CustomDomainDTO>(`${path}/domain`, {
          method: 'PUT',
          body: JSON.stringify({ domain: domainDraft.trim() }),
        }),
      () => t('settings.domain.saved'),
    );
  const removeDomain = () =>
    domainAction(
      () => bffJson<CustomDomainDTO>(`${path}/domain`, { method: 'PUT', body: JSON.stringify({ domain: null }) }),
      () => t('settings.domain.removed'),
    );
  const verifyDomain = () =>
    domainAction(
      () => bffJson<CustomDomainDTO>(`${path}/domain/verify`, { method: 'POST', body: '{}' }),
      (status) =>
        status.verifiedAt
          ? t('settings.domain.verifiedNow', { domain: status.domain ?? '' })
          : t('settings.domain.notYet'),
    );

  const requestListing = async () => {
    setBusy(true);
    setError(null);
    setLogoNotice(null);
    try {
      setData(await bffJson<RestaurantSettingsDTO>(`${path}/listing-request`, { method: 'POST', body: '{}' }));
      setSaved('platform');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const removeLogo = async () => {
    setBusy(true);
    setError(null);
    setLogoNotice(null);
    try {
      applyLogo(await bffJson<RestaurantSettingsDTO>(`${path}/logo`, { method: 'DELETE' }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
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
          <div className="flex flex-col gap-2 md:col-span-2">
            {data.logoUrl && (
              <img
                src={data.logoUrl}
                alt={t('settings.brand.currentLogo')}
                width={64}
                height={64}
                className="h-16 w-16 object-contain"
              />
            )}
            <label className="pui-field-group" htmlFor="s-logo-file">
              <span>{t('settings.brand.logoFile')}</span>
              <input
                id="s-logo-file"
                type="file"
                className="pui-input"
                accept="image/png,image/jpeg,image/webp"
                disabled={!canManage}
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              />
              <small className="ui-text-muted">{t('settings.brand.logoRules')}</small>
            </label>
            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void uploadLogo()} disabled={busy || !logoFile}>
                  {t('settings.brand.upload')}
                </Button>
                {data.logoUrl && (
                  <Button variant="outline" tone="muted" onClick={() => void removeLogo()} disabled={busy}>
                    {t('settings.brand.removeLogo')}
                  </Button>
                )}
                {logoNotice && <span className="ui-caption">{logoNotice}</span>}
              </div>
            )}
          </div>
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

      <Card
        title={t('settings.domain.title')}
        aria-label={t('settings.domain.title')}
        aside={
          domainStatus?.domain ? (
            <Badge tone={domainStatus.verifiedAt ? 'success' : 'warn'}>
              {domainStatus.verifiedAt ? t('settings.domain.verified') : t('settings.domain.pending')}
            </Badge>
          ) : undefined
        }
      >
        <p className="ui-text-muted">{t('settings.domain.intro')}</p>
        {!data.entitlements.includes('custom_domain') && (
          <p className="ui-caption">{t('settings.domain.proRequired')}</p>
        )}
        {domainStatus && (
          <div className="flex flex-col gap-3">
            <p>
              {domainStatus.domain
                ? t('settings.domain.current', { domain: domainStatus.domain })
                : t('settings.domain.none')}
            </p>
            {domainStatus.domain && !domainStatus.verifiedAt && (
              <p className="ui-caption">
                {t('settings.domain.instruction', { domain: domainStatus.domain, target: domainStatus.target })}
              </p>
            )}
            {domainStatus.challenge && !domainStatus.verifiedAt && (
              <p className="ui-caption" data-domain-challenge>
                {t('settings.domain.txtInstruction', {
                  name: domainStatus.challenge.name,
                  value: domainStatus.challenge.value,
                })}
              </p>
            )}
            {domainStatus.domain && domainStatus.verifiedAt && !domainStatus.active && (
              <p className="ui-caption">{t('settings.domain.planLapsed')}</p>
            )}
            {domainStatus.lastCheck && domainStatus.lastCheck.ownershipProven === false && (
              <p className="ui-caption">{t('settings.domain.txtMissing')}</p>
            )}
            {domainStatus.lastCheck && !domainStatus.lastCheck.ok && (
              <p className="ui-caption">
                {domainStatus.lastCheck.seen.length > 0
                  ? t('settings.domain.seen', { records: domainStatus.lastCheck.seen.join(', ') })
                  : t('settings.domain.seenNone')}
              </p>
            )}
            {canManage && (
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <TextField
                  label={t('settings.domain.domain')}
                  value={domainDraft}
                  onChange={(e) => setDomainDraft(e.target.value)}
                  placeholder="siparis.restoranim.com"
                  autoComplete="off"
                  disabled={!data.entitlements.includes('custom_domain')}
                />
                <Button
                  onClick={() => void saveDomain()}
                  disabled={busy || !data.entitlements.includes('custom_domain') || domainDraft.trim().length < 4}
                >
                  {t('settings.domain.save')}
                </Button>
                {domainStatus.domain && !domainStatus.verifiedAt && (
                  <Button
                    variant="outline"
                    onClick={() => void verifyDomain()}
                    disabled={busy || !data.entitlements.includes('custom_domain')}
                  >
                    {t('settings.domain.verify')}
                  </Button>
                )}
                {domainStatus.domain && (
                  <Button
                    variant="outline"
                    tone="muted"
                    onClick={() => void removeDomain()}
                    disabled={busy || !data.entitlements.includes('custom_domain')}
                  >
                    {t('settings.domain.remove')}
                  </Button>
                )}
              </div>
            )}
            {domainNotice && (
              <p role="status" className="ui-caption">
                {domainNotice}
              </p>
            )}
          </div>
        )}
      </Card>

      <Card title={t('settings.platform.title')} aria-label={t('settings.platform.title')}>
        <ul className="ui-divide">
          <li className="py-2">{t('settings.platform.commission', { percent: data.commissionBps / 100 })}</li>
          <li className="py-2">{t('settings.platform.currency', { currency })}</li>
          <li className="py-2">{t('settings.platform.country', { country: data.countryCode })}</li>
          <li className="py-2">
            {t('settings.platform.plan', { plan: panelPlanLabel(t, data.effectivePlan, data.planName) })}
          </li>
          <li className="py-2">{data.isListed ? t('settings.platform.listed') : t('settings.platform.notListed')}</li>
          {!data.isListed && data.listingRequestedAt && !data.listingReviewedAt && (
            <li className="py-2">
              {t('settings.platform.requested', {
                date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                  new Date(data.listingRequestedAt),
                ),
              })}
            </li>
          )}
          {!data.isListed && data.listingReviewedAt && data.listingReviewNote && (
            <li className="py-2">{t('settings.platform.declined', { note: data.listingReviewNote })}</li>
          )}
        </ul>
        {canManage && !data.isListed && !(data.listingRequestedAt && !data.listingReviewedAt) && (
          <div className="flex flex-col gap-2">
            <p className="ui-caption">{t('settings.platform.requestHelp')}</p>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => void requestListing()} disabled={busy}>
                {t('settings.platform.requestListing')}
              </Button>
              {saved === 'platform' && <span className="ui-caption">{t('settings.platform.requestSent')}</span>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
