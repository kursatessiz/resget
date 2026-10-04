'use client';

import { useCallback, useEffect, useState } from 'react';
import { AD_CONNECTION_PLATFORMS, AD_CREDENTIAL_FIELDS, AD_REPORT_RANGE_DAYS, formatMoney } from '@resget/shared';
import type { AdConnectionDTO, AdConnectionPlatform, AdPerformanceDTO, ConversionType } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUS_TONE: Record<AdConnectionDTO['status'], UiTone> = { ACTIVE: 'success', PAUSED: 'muted', ERROR: 'error' };

/**
 * Ad accounts (docs/REKLAM.md): connect Meta, Google Ads and TikTok, choose
 * which conversions go out and whether hashed contact data may, pause,
 * disconnect, pull spend, and read spend against attributed revenue.
 */
export function AdsManager({
  restaurantId,
  locale,
  conversionTypes,
}: {
  restaurantId: string;
  locale: string;
  /** The conversion types this tenant records (restaurant or platform). */
  conversionTypes: readonly ConversionType[];
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/ads`;
  const [connections, setConnections] = useState<AdConnectionDTO[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<AdPerformanceDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);

  const load = useCallback(async () => {
    const [list, perf] = await Promise.all([
      bffJson<AdConnectionDTO[]>(`${base}/connections`),
      bffJson<AdPerformanceDTO>(`${base}/performance?days=${days}`),
    ]);
    setConnections(list);
    setReport(perf);
  }, [base, days]);

  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await run();
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const draftOf = (platform: AdConnectionPlatform) => drafts[platform] ?? {};
  const setField = (platform: AdConnectionPlatform, key: string, value: string) =>
    setDrafts((current) => ({ ...current, [platform]: { ...draftOf(platform), [key]: value } }));

  const connect = (platform: AdConnectionPlatform, existing: AdConnectionDTO | undefined) =>
    act(async () => {
      const credentials = Object.fromEntries(
        Object.entries(draftOf(platform)).filter(([, value]) => value.trim() !== ''),
      );
      await bffJson<AdConnectionDTO>(`${base}/connections/${platform}`, {
        method: 'PUT',
        body: JSON.stringify({ credentials }),
      });
      setDrafts((current) => ({ ...current, [platform]: {} }));
      setNotice(existing ? t('ads.updated') : t('ads.connected'));
    });

  const patch = (platform: AdConnectionPlatform, body: Record<string, unknown>) =>
    act(async () => {
      await bffJson<AdConnectionDTO>(`${base}/connections/${platform}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setNotice(t('ads.updated'));
    });

  const remove = (platform: AdConnectionPlatform) =>
    act(async () => {
      await bffJson<void>(`${base}/connections/${platform}`, { method: 'DELETE' });
      setNotice(t('ads.removed'));
    });

  const sync = () =>
    act(async () => {
      const result = await bffJson<{ rows: number }>(`${base}/spend/sync`, { method: 'POST', body: '{}' });
      setNotice(t('ads.synced', { rows: result.rows }));
    });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="ui-title">{t('ads.title')}</h2>
        <p className="ui-text-muted">{t('ads.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="pui-alert pui-success">
          {notice}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {AD_CONNECTION_PLATFORMS.map((platform) => {
          const connection = connections.find((c) => c.platform === platform);
          const title = t(`ads.platform.${platform}`);
          return (
            <Card
              key={platform}
              title={title}
              aria-label={title}
              aside={
                <Badge tone={connection ? STATUS_TONE[connection.status] : 'muted'}>
                  {connection ? t(`ads.status.${connection.status}`) : t('ads.notConnected')}
                </Badge>
              }
            >
              <div className="flex flex-col gap-3">
                {AD_CREDENTIAL_FIELDS[platform].map((field) => (
                  <TextField
                    key={field.key}
                    label={t(`ads.field.${field.key}`)}
                    type={field.secret ? 'password' : 'text'}
                    autoComplete="off"
                    help={field.secret && connection?.secretsSet.includes(field.key) ? t('ads.secretSet') : undefined}
                    value={draftOf(platform)[field.key] ?? (field.secret ? '' : (connection?.config[field.key] ?? ''))}
                    onChange={(e) => setField(platform, field.key, e.target.value)}
                  />
                ))}
                <div>
                  <Button onClick={() => connect(platform, connection)} disabled={busy}>
                    {connection ? t('ads.save') : t('ads.connect')}
                  </Button>
                </div>
              </div>
              {connection && (
                <div className="flex flex-col gap-3 ui-rule pt-3">
                  <fieldset className="flex flex-col gap-2">
                    <legend className="ui-caption">{t('ads.sendTypes')}</legend>
                    {conversionTypes.map((type) => (
                      <label key={type} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="pui-checkbox"
                          checked={connection.sendTypes.includes(type)}
                          disabled={busy}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...connection.sendTypes, type]
                              : connection.sendTypes.filter((s) => s !== type);
                            if (next.length > 0) void patch(platform, { sendTypes: next });
                          }}
                        />
                        <span>{t(`attribution.conversion.${type}`)}</span>
                      </label>
                    ))}
                  </fieldset>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="pui-checkbox"
                      checked={connection.enhancedMatching}
                      disabled={busy}
                      onChange={(e) => void patch(platform, { enhancedMatching: e.target.checked })}
                    />
                    <span className="flex flex-col gap-1">
                      <span>{t('ads.enhanced')}</span>
                      <span className="ui-caption">{t('ads.enhancedHelp')}</span>
                    </span>
                  </label>
                  <p className="ui-caption">{t('ads.deliveries', { ...connection.deliveries })}</p>
                  {connection.lastSentAt && (
                    <p className="ui-caption">{t('ads.lastSent', { date: when(connection.lastSentAt) })}</p>
                  )}
                  {connection.lastError && (
                    <p className="ui-caption">{t('ads.lastError', { code: connection.lastError })}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {connection.status === 'ACTIVE' ? (
                      <Button
                        variant="outline"
                        tone="muted"
                        onClick={() => patch(platform, { status: 'PAUSED' })}
                        disabled={busy}
                      >
                        {t('ads.pause')}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        tone="muted"
                        onClick={() => patch(platform, { status: 'ACTIVE' })}
                        disabled={busy}
                      >
                        {t('ads.resume')}
                      </Button>
                    )}
                    <Button variant="outline" tone="error" onClick={() => remove(platform)} disabled={busy}>
                      {t('ads.disconnect')}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <p className="ui-caption">{t('ads.rules')}</p>

      <Card
        title={t('ads.perf.title')}
        aria-label={t('ads.perf.title')}
        aside={
          <Button variant="outline" tone="muted" onClick={sync} disabled={busy || connections.length === 0}>
            {t('ads.syncSpend')}
          </Button>
        }
      >
        <SelectField label={t('ads.perf.range')} value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          {AD_REPORT_RANGE_DAYS.map((d) => (
            <option key={d} value={d}>
              {t('ads.perf.days', { days: d })}
            </option>
          ))}
        </SelectField>
        {report && report.rows.length === 0 && <p className="ui-text-muted">{t('ads.perf.empty')}</p>}
        {report && report.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="pui-table w-full">
              <thead>
                <tr>
                  <th scope="col">{t('ads.perf.platform')}</th>
                  <th scope="col">{t('ads.perf.spend')}</th>
                  <th scope="col">{t('ads.perf.impressions')}</th>
                  <th scope="col">{t('ads.perf.clicks')}</th>
                  <th scope="col">{t('ads.perf.conversions')}</th>
                  <th scope="col">{t('ads.perf.revenue')}</th>
                  <th scope="col">{t('ads.perf.roas')}</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={`${row.platform}-${row.currency}`} data-ads-row={row.platform}>
                    <td>{t(`ads.platform.${row.platform}`)}</td>
                    <td>{formatMoney({ amountMinor: row.spendMinor, currency: row.currency }, locale)}</td>
                    <td>{number(row.impressions)}</td>
                    <td>{number(row.clicks)}</td>
                    <td>{number(row.conversions)}</td>
                    <td>{formatMoney({ amountMinor: row.revenueMinor, currency: row.currency }, locale)}</td>
                    <td>
                      {row.roasBps === null
                        ? '-'
                        : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
                            row.roasBps / 10_000,
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="ui-caption">{t('ads.perf.note')}</p>
      </Card>
    </div>
  );
}
