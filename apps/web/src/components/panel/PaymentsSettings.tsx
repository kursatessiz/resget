'use client';

import { useCallback, useEffect, useState } from 'react';
import { MEAL_CARD_PROVIDERS, OWN_POS_PROVIDERS, OWN_POS_PROVIDER_CODES, formatMoney } from '@resget/shared';
import type {
  MealCardConnectionDTO,
  MealCardProviderCode,
  MealCardSettingsDTO,
  OwnPosProviderCode,
  PaymentModeValue,
  PaymentSettingsDTO,
  Translate,
} from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUS_TONE: Record<string, UiTone> = {
  ACTIVE: 'success',
  PENDING_VERIFICATION: 'warn',
  FAILED: 'error',
  DISABLED: 'muted',
};

const SECRET_FIELD = /key|secret|password|salt/i;

function isOwnPosCode(code: string): code is OwnPosProviderCode {
  return (OWN_POS_PROVIDER_CODES as readonly string[]).includes(code);
}

/** Payment mode, the restaurant's own POS connection and the meal cards it takes (docs/ODEME.md, docs/YEMEK_KARTI.md). */
export function PaymentsSettings({
  restaurantId,
  locale,
  allowMock,
}: {
  restaurantId: string;
  locale: string;
  allowMock: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/payments`;
  const [settings, setSettings] = useState<PaymentSettingsDTO | null>(null);
  const [mealCards, setMealCards] = useState<MealCardSettingsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<PaymentModeValue>('OWN_POS');
  const [connecting, setConnecting] = useState(false);
  const [provider, setProvider] = useState<OwnPosProviderCode>('IYZICO');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [editingCard, setEditingCard] = useState<MealCardProviderCode | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([bffJson<PaymentSettingsDTO>(`${base}/settings`), bffJson<MealCardSettingsDTO>(`${base}/meal-cards`)])
      .then(([s, m]) => {
        if (cancelled) return;
        setSettings(s);
        setMode(s.paymentMode);
        setMealCards(m);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [base, fail]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  if (!settings || !mealCards) {
    return (
      <>
        <h1 className="ui-title">{t('payments.title')}</h1>
        <p className="ui-text-muted">{error ?? t('common.loading')}</p>
      </>
    );
  }

  const providers = OWN_POS_PROVIDER_CODES.filter((code) => code !== 'MOCK' || allowMock);
  const spec = OWN_POS_PROVIDERS[provider];
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const connection = settings.connection;
  const connectionName = connection
    ? isOwnPosCode(connection.providerCode)
      ? OWN_POS_PROVIDERS[connection.providerCode].name
      : connection.providerCode
    : '';

  const saveMode = () =>
    run(async () => {
      setSettings(
        await bffJson<PaymentSettingsDTO>(`${base}/mode`, {
          method: 'PUT',
          body: JSON.stringify({ paymentMode: mode }),
        }),
      );
    });

  const connect = () =>
    run(async () => {
      const filled = Object.fromEntries(Object.entries(credentials).filter(([, value]) => value.trim()));
      setSettings(
        await bffJson<PaymentSettingsDTO>(`${base}/connection`, {
          method: 'PUT',
          body: JSON.stringify({ providerCode: provider, credentials: filled }),
        }),
      );
      setConnecting(false);
      setCredentials({});
    });

  const disconnect = () => {
    if (!window.confirm(t('payments.connection.confirmDisconnect'))) return;
    void run(async () => setSettings(await bffJson<PaymentSettingsDTO>(`${base}/connection`, { method: 'DELETE' })));
  };

  const saveCard = (body: Record<string, unknown>) =>
    run(async () => {
      setMealCards(
        await bffJson<MealCardSettingsDTO>(`${base}/meal-cards`, { method: 'PUT', body: JSON.stringify(body) }),
      );
      setEditingCard(null);
    });

  const removeCard = (code: MealCardProviderCode) => {
    if (!window.confirm(t('payments.mealCards.confirmRemove'))) return;
    void run(async () =>
      setMealCards(await bffJson<MealCardSettingsDTO>(`${base}/meal-cards/${code}`, { method: 'DELETE' })),
    );
  };

  return (
    <>
      <h1 className="ui-title">{t('payments.title')}</h1>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}

      <Card title={t('payments.mode.label')} aria-label={t('payments.mode.label')}>
        <SelectField
          id="pay-mode"
          label={t('payments.mode.label')}
          help={t(`payments.mode.${mode}.help`)}
          value={mode}
          onChange={(e) => setMode(e.target.value as PaymentModeValue)}
        >
          <option value="OWN_POS">{t('payments.mode.OWN_POS')}</option>
          <option value="PLATFORM_PSP">{t('payments.mode.PLATFORM_PSP')}</option>
        </SelectField>
        <p className="ui-caption">{t('payments.mode.changeNote')}</p>
        {settings.paymentMode === 'OWN_POS' && (
          <p className="ui-text-muted">
            {t('payments.commission.accrued', {
              amount: formatMoney(
                { amountMinor: settings.accruedCommissionMinor, currency: settings.currency },
                locale,
              ),
            })}
          </p>
        )}
        <div>
          <Button onClick={saveMode} disabled={busy || mode === settings.paymentMode}>
            {t('common.save')}
          </Button>
        </div>
      </Card>

      <Card title={t('payments.connection.title')} aria-label={t('payments.connection.title')}>
        {connection ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-heading">{connectionName}</span>
            <Badge tone={STATUS_TONE[connection.status] ?? 'muted'}>
              {t(`payments.connection.status.${connection.status}`)}
            </Badge>
            <span className="ui-text-muted">{connection.label}</span>
            {connection.lastVerifiedAt && (
              <span className="ui-caption">
                {t('payments.connection.lastVerified', {
                  date: dateFormat.format(new Date(connection.lastVerifiedAt)),
                })}
              </span>
            )}
          </div>
        ) : (
          <p className="ui-text-muted">{t('payments.connection.none')}</p>
        )}
        <p className="ui-caption">{t('payments.connection.required')}</p>
        {connecting ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <SelectField
              id="pos-provider"
              label={t('payments.connection.provider')}
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as OwnPosProviderCode);
                setCredentials({});
              }}
            >
              {providers.map((code) => (
                <option key={code} value={code}>
                  {OWN_POS_PROVIDERS[code].name}
                </option>
              ))}
            </SelectField>
            <div className="grid gap-3 md:grid-cols-2">
              {[...spec.fields, ...spec.optionalFields].map((field) => (
                <TextField
                  key={field}
                  id={`pos-${field}`}
                  label={t(`payments.field.${field}`)}
                  type={SECRET_FIELD.test(field) ? 'password' : 'text'}
                  autoComplete="off"
                  value={credentials[field] ?? ''}
                  onChange={(e) => setCredentials((c) => ({ ...c, [field]: e.target.value }))}
                  required={(spec.fields as readonly string[]).includes(field)}
                />
              ))}
            </div>
            <p className="ui-caption">{t('payments.connection.secretNote')}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                {t('payments.connection.connect')}
              </Button>
              <Button variant="outline" tone="muted" onClick={() => setConnecting(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant={connection ? 'outline' : 'solid'} onClick={() => setConnecting(true)} disabled={busy}>
              {connection ? t('payments.connection.replace') : t('payments.connection.connect')}
            </Button>
            {connection && (
              <Button variant="outline" tone="error" onClick={disconnect} disabled={busy}>
                {t('payments.connection.disconnect')}
              </Button>
            )}
          </div>
        )}
      </Card>

      <Card title={t('payments.mealCards.title')} aria-label={t('payments.mealCards.title')}>
        <p className="ui-text-muted">{t('payments.mealCards.intro')}</p>
        <ul className="ui-divide">
          {mealCards.catalog.map((entry) => {
            const current = mealCards.connections.find((c) => c.providerCode === entry.providerCode) ?? null;
            return (
              <li key={entry.providerCode} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="ui-heading">{entry.name}</span>
                    {current?.acceptsOnDelivery && <Badge tone="success">{t('payments.mealCards.atDoor')}</Badge>}
                    {current?.acceptsOnline && (
                      <Badge tone={STATUS_TONE[current.status] ?? 'muted'}>
                        {t('payments.mealCards.online')}: {t(`payments.connection.status.${current.status}`)}
                      </Badge>
                    )}
                    {current?.label && <span className="ui-caption">{current.label}</span>}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <Button
                      variant="outline"
                      tone="muted"
                      disabled={busy}
                      onClick={() => setEditingCard(entry.providerCode)}
                    >
                      {current ? t('payments.mealCards.edit') : t('payments.mealCards.add')}
                    </Button>
                    {current && (
                      <Button
                        variant="link"
                        tone="error"
                        disabled={busy}
                        onClick={() => removeCard(entry.providerCode)}
                      >
                        {t('payments.mealCards.remove')}
                      </Button>
                    )}
                  </span>
                </div>
                {editingCard === entry.providerCode && (
                  <MealCardForm
                    code={entry.providerCode}
                    onlineAvailable={entry.onlineAvailable}
                    current={current}
                    busy={busy}
                    t={t}
                    onSave={(body) => void saveCard(body)}
                    onCancel={() => setEditingCard(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
        <p className="ui-caption">{t('payments.mealCards.settlementNote')}</p>
      </Card>
    </>
  );
}

function MealCardForm({
  code,
  onlineAvailable,
  current,
  busy,
  t,
  onSave,
  onCancel,
}: {
  code: MealCardProviderCode;
  onlineAvailable: boolean;
  current: MealCardConnectionDTO | null;
  busy: boolean;
  t: Translate;
  onSave: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const spec = MEAL_CARD_PROVIDERS[code];
  const [atDoor, setAtDoor] = useState(current?.acceptsOnDelivery ?? true);
  const [online, setOnline] = useState(current?.acceptsOnline ?? false);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  // Credentials are required when online acceptance is switched on for the first time; later only to replace them.
  const needsCredentials = online && !current?.acceptsOnline;
  return (
    <form
      className="flex flex-col gap-3"
      aria-label={spec.name}
      onSubmit={(event) => {
        event.preventDefault();
        const filled = Object.fromEntries(Object.entries(credentials).filter(([, value]) => value.trim()));
        onSave({
          providerCode: code,
          acceptsOnDelivery: atDoor,
          acceptsOnline: online,
          ...(online && Object.keys(filled).length > 0 ? { credentials: filled } : {}),
        });
      }}
    >
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="pui-checkbox"
          checked={atDoor}
          onChange={(e) => setAtDoor(e.target.checked)}
        />
        <span>{t('payments.mealCards.acceptsOnDelivery')}</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="pui-checkbox"
          checked={online}
          disabled={!onlineAvailable}
          onChange={(e) => setOnline(e.target.checked)}
        />
        <span>{t('payments.mealCards.acceptsOnline')}</span>
      </label>
      {!onlineAvailable && <p className="ui-caption">{t('payments.mealCards.onlineUnavailable')}</p>}
      {online && (
        <fieldset className="grid gap-3 md:grid-cols-2">
          <legend className="ui-caption">{t('payments.mealCards.credentials')}</legend>
          {[...spec.fields, ...spec.optionalFields].map((field) => (
            <TextField
              key={field}
              id={`card-${code}-${field}`}
              label={t(`payments.field.${field}`)}
              type={SECRET_FIELD.test(field) ? 'password' : 'text'}
              autoComplete="off"
              value={credentials[field] ?? ''}
              onChange={(e) => setCredentials((c) => ({ ...c, [field]: e.target.value }))}
              required={needsCredentials && (spec.fields as readonly string[]).includes(field)}
            />
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {t('common.save')}
        </Button>
        <Button variant="outline" tone="muted" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
