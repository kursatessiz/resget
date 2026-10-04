'use client';

import { useState } from 'react';
import { CONSENT_CHANNELS } from '@resget/shared';
import type { ConsentChannel, ContactConsentDTO } from '@resget/shared';
import { Badge, Button, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

interface Props {
  restaurantId: string;
  customerId: string;
  consent: ContactConsentDTO;
  canManage: boolean;
  locale: string;
  onChanged: () => void;
}

/**
 * A contact's consent per channel (docs/RIZA.md): what counts now, where it
 * came from, the registry state, and the full history. Staff can record a
 * refusal and mark a business; nobody but the customer can say yes.
 */
export function ContactConsentPanel({ restaurantId, customerId, consent, canManage, locale, onChanged }: Props) {
  const t = useT(locale);
  const [channels, setChannels] = useState<ConsentChannel[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const base = `restaurants/${restaurantId}/consent/customers/${customerId}`;

  const run = async (path: string, init: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      await bffJson<ContactConsentDTO>(path, init);
      setChannels([]);
      setNote('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  const status = (channel: ConsentChannel) => {
    const entry = consent.current.find((c) => c.channel === channel);
    if (consent.effective.includes(channel)) return { tone: 'success' as const, label: t('consent.state.active') };
    if (!entry) return { tone: 'muted' as const, label: t('consent.state.none') };
    if (!entry.granted) return { tone: 'error' as const, label: t('consent.state.refused') };
    if (entry.confirmationRequestedAt && !entry.confirmedAt)
      return { tone: 'warn' as const, label: t('consent.state.pending') };
    return { tone: 'muted' as const, label: t('consent.state.inactive') };
  };

  return (
    <section className="flex flex-col gap-3" aria-label={t('consent.card.title')}>
      <h3 className="ui-heading">{t('consent.card.title')}</h3>
      <p className="ui-caption">
        {t('consent.card.region', { region: t(`consent.region.${consent.region}`) })}
        {consent.isBusiness ? ` / ${t('consent.card.business')}` : ''}
      </p>
      <ul className="ui-divide">
        {CONSENT_CHANNELS.map((channel) => {
          const entry = consent.current.find((c) => c.channel === channel);
          const s = status(channel);
          return (
            <li key={channel} className="flex flex-col gap-1 py-2" data-consent-channel={channel}>
              <span className="flex flex-wrap items-center gap-2">
                <span>{t(`consent.channel.${channel}`)}</span>
                <Badge tone={s.tone}>{s.label}</Badge>
              </span>
              {entry && (
                <span className="ui-caption">
                  {t(`consent.basis.${entry.legalBasis}`)} / {t(`consent.source.${entry.source}`)} /{' '}
                  {time.format(new Date(entry.createdAt))}
                  {entry.registrySyncedAt ? ` / ${t('consent.card.registrySynced')}` : ''}
                  {entry.note ? ` / ${entry.note}` : ''}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {canManage && (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="pui-checkbox"
              checked={consent.isBusiness}
              disabled={busy}
              onChange={(e) =>
                void run(`${base}/business`, { method: 'PUT', body: JSON.stringify({ isBusiness: e.target.checked }) })
              }
            />
            <span>{t('consent.card.markBusiness')}</span>
          </label>
          <form
            className="flex flex-col gap-2"
            aria-label={t('consent.optOut.title')}
            onSubmit={(event) => {
              event.preventDefault();
              void run(`${base}/opt-out`, { method: 'POST', body: JSON.stringify({ channels, note: note.trim() }) });
            }}
          >
            <span>{t('consent.optOut.title')}</span>
            <span className="ui-caption">{t('consent.optOut.help')}</span>
            <div className="flex flex-wrap gap-3">
              {CONSENT_CHANNELS.map((channel) => (
                <label key={channel} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="pui-checkbox"
                    checked={channels.includes(channel)}
                    onChange={(e) =>
                      setChannels((current) =>
                        e.target.checked ? [...current, channel] : current.filter((c) => c !== channel),
                      )
                    }
                  />
                  <span>{t(`consent.channel.${channel}`)}</span>
                </label>
              ))}
            </div>
            <TextField
              label={t('consent.optOut.note')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
            <div>
              <Button
                type="submit"
                variant="outline"
                tone="error"
                disabled={busy || channels.length === 0 || note.trim().length < 3}
              >
                {t('consent.optOut.submit')}
              </Button>
            </div>
          </form>
        </>
      )}
      {consent.history.length > consent.current.length && (
        <details>
          <summary className="ui-caption">{t('consent.card.history', { count: consent.history.length })}</summary>
          <ul className="ui-divide">
            {consent.history.map((entry, index) => (
              <li key={`${entry.channel}-${entry.createdAt}-${index}`} className="ui-caption py-1">
                {time.format(new Date(entry.createdAt))} / {t(`consent.channel.${entry.channel}`)} /{' '}
                {entry.granted ? t('consent.state.granted') : t('consent.state.refused')} /{' '}
                {t(`consent.source.${entry.source}`)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
    </section>
  );
}
