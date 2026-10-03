'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  AdminRestaurantDTO,
  CreditChannel,
  GrantCreditsResultDTO,
  PaymentModeValue,
  ServiceAreaDTO,
} from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** One restaurant in the console: listing, activity, commission and fees, service area and manual credit grants. */
export function AdminRestaurantDetail({ id, locale }: { id: string; locale: string }) {
  const t = useT(locale);
  const base = `admin/restaurants/${id}`;
  const [data, setData] = useState<AdminRestaurantDTO | null>(null);
  const [areas, setAreas] = useState<ServiceAreaDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commission, setCommission] = useState('1');
  const [pspPercent, setPspPercent] = useState('0');
  const [pspFixed, setPspFixed] = useState('0');
  const [paymentMode, setPaymentMode] = useState<PaymentModeValue>('OWN_POS');
  const [areaId, setAreaId] = useState('');
  const [grant, setGrant] = useState({ channel: 'SMS' as CreditChannel, credits: '100', note: '' });

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  const apply = useCallback((dto: AdminRestaurantDTO) => {
    setData(dto);
    setCommission(String(dto.commissionBps / 100));
    setPspPercent(String(dto.pspPercentBps / 100));
    setPspFixed(String(dto.pspFixedMinor));
    setPaymentMode(dto.paymentMode);
    setAreaId(dto.serviceArea?.id ?? '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([bffJson<AdminRestaurantDTO>(base), bffJson<ServiceAreaDTO[]>('admin/service-areas')])
      .then(([dto, list]) => {
        if (cancelled) return;
        apply(dto);
        setAreas(list);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [base, apply, fail]);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      apply(await bffJson<AdminRestaurantDTO>(base, { method: 'PATCH', body: JSON.stringify(body) }));
      setNotice(t('common.saved'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const grantCredits = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await bffJson<GrantCreditsResultDTO>(`${base}/credits`, {
        method: 'POST',
        body: JSON.stringify({ channel: grant.channel, credits: Number(grant.credits), note: grant.note.trim() }),
      });
      setNotice(
        t('admin.restaurant.credits.done', {
          channel: t(`messaging.wallet.channel.${result.channel}`),
          balance: result.balance,
        }),
      );
      setGrant({ ...grant, note: '' });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="ui-text-muted">{error ?? t('common.loading')}</p>;
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="ui-title">{data.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-text-muted">{data.slug}</span>
          <Badge tone={data.isListed ? 'success' : 'muted'}>
            {data.isListed ? t('admin.restaurant.listed') : t('admin.restaurant.notListed')}
          </Badge>
          {data.listingSuspendedAt && (
            <Badge tone="error">
              {t('admin.restaurant.suspended', {
                date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                  new Date(data.listingSuspendedAt),
                ),
              })}
            </Badge>
          )}
          <Badge tone={data.isActive ? 'success' : 'error'}>
            {data.isActive ? t('admin.restaurant.active') : t('admin.restaurant.inactive')}
          </Badge>
          {data.plan && (
            <Badge>
              {t('admin.restaurant.plan', { plan: t(`plans.${data.plan.code}.name`), status: data.plan.status })}
            </Badge>
          )}
        </div>
        <p className="ui-caption">
          {data.owner
            ? t('admin.restaurant.owner', { name: data.owner.fullName, phone: data.owner.phone })
            : t('admin.restaurant.noOwner')}
          {data.plan?.trialEndsAt
            ? ` / ${t('admin.restaurant.trialEnds', { date: dateFormat.format(new Date(data.plan.trialEndsAt)) })}`
            : ''}
          {` / ${t('admin.restaurant.orders7d', { count: data.ordersLast7Days })}`}
        </p>
      </header>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      {notice && <p className="ui-caption">{notice}</p>}

      <Card aria-label={t('admin.restaurant.listed')}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={data.isListed ? 'outline' : 'solid'}
            tone={data.isListed ? 'warn' : 'theme'}
            disabled={busy}
            onClick={() => patch({ isListed: !data.isListed })}
          >
            {data.isListed ? t('admin.restaurant.toggleUnlisted') : t('admin.restaurant.toggleListed')}
          </Button>
          <Button
            variant="outline"
            tone={data.isActive ? 'error' : 'success'}
            disabled={busy}
            onClick={() => {
              if (data.isActive && !window.confirm(t('admin.restaurant.confirmDeactivate'))) return;
              void patch({ isActive: !data.isActive });
            }}
          >
            {data.isActive ? t('admin.restaurant.deactivate') : t('admin.restaurant.activate')}
          </Button>
        </div>
      </Card>

      <Card title={t('admin.restaurant.commission')} aria-label={t('admin.restaurant.commission')}>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField
            id="ad-commission"
            label={t('admin.restaurant.commission')}
            help={t('admin.restaurant.commissionHelp')}
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            inputMode="decimal"
          />
          <SelectField
            id="ad-mode"
            label={t('admin.restaurant.paymentMode')}
            value={paymentMode}
            onChange={(e) => setPaymentMode(e.target.value as PaymentModeValue)}
          >
            <option value="OWN_POS">{t('payments.mode.OWN_POS')}</option>
            <option value="PLATFORM_PSP">{t('payments.mode.PLATFORM_PSP')}</option>
          </SelectField>
          <TextField
            id="ad-psp-percent"
            label={t('admin.restaurant.pspPercent')}
            value={pspPercent}
            onChange={(e) => setPspPercent(e.target.value)}
            inputMode="decimal"
          />
          <TextField
            id="ad-psp-fixed"
            label={t('admin.restaurant.pspFixed')}
            value={pspFixed}
            onChange={(e) => setPspFixed(e.target.value)}
            inputMode="numeric"
          />
          <SelectField
            id="ad-area"
            label={t('admin.restaurant.serviceArea')}
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
          >
            <option value="">{t('admin.restaurant.noServiceArea')}</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.city} / {a.district} ({a.countryCode})
              </option>
            ))}
          </SelectField>
        </div>
        <div>
          <Button
            disabled={busy}
            onClick={() =>
              patch({
                commissionBps: Math.round(Number(commission.replace(',', '.')) * 100),
                pspPercentBps: Math.round(Number(pspPercent.replace(',', '.')) * 100),
                pspFixedMinor: Math.round(Number(pspFixed)),
                paymentMode,
                serviceAreaId: areaId || null,
              })
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>

      <Card title={t('admin.restaurant.credits.title')} aria-label={t('admin.restaurant.credits.title')}>
        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            void grantCredits();
          }}
        >
          <SelectField
            id="ad-grant-channel"
            label={t('admin.restaurant.credits.channel')}
            value={grant.channel}
            onChange={(e) => setGrant({ ...grant, channel: e.target.value as CreditChannel })}
          >
            <option value="SMS">{t('messaging.wallet.channel.SMS')}</option>
            <option value="WHATSAPP">{t('messaging.wallet.channel.WHATSAPP')}</option>
          </SelectField>
          <TextField
            id="ad-grant-credits"
            label={t('admin.restaurant.credits.amount')}
            type="number"
            min={1}
            max={100000}
            value={grant.credits}
            onChange={(e) => setGrant({ ...grant, credits: e.target.value })}
            required
          />
          <TextField
            id="ad-grant-note"
            label={t('admin.restaurant.credits.note')}
            value={grant.note}
            onChange={(e) => setGrant({ ...grant, note: e.target.value })}
            minLength={2}
            maxLength={200}
            required
          />
          <div className="md:col-span-3">
            <Button type="submit" disabled={busy}>
              {t('admin.restaurant.credits.grant')}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
