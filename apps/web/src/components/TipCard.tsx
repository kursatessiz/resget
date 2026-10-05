'use client';

import { useState } from 'react';
import { formatMoney, majorAmountText, parseMajorAmount } from '@resget/shared';
import type { OrderTrackingDTO, TipStartedDTO, Translate } from '@resget/shared';
import { Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';

/**
 * The courier tip on the tracking page (docs/BAHSIS.md): suggested amounts
 * or one the customer types, paid on the provider's hosted page. The state
 * of a given tip stays visible after the offer closes.
 */
export function TipCard({
  token,
  tracking,
  t,
  locale,
}: {
  token: string;
  tracking: OrderTrackingDTO;
  t: Translate;
  locale: string;
}) {
  const offer = tracking.tipOffer;
  const [amount, setAmount] = useState<number | null>(offer?.presetsMinor[1] ?? offer?.presetsMinor[0] ?? null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tip = tracking.tip;
  if (!offer && !tip) return null;

  const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency }, locale);
  const chosen = custom.trim() && offer ? parseMajorAmount(custom, offer.currency) : amount;
  const valid = offer !== null && chosen !== null && chosen >= offer.minMinor && chosen <= offer.maxMinor;

  const submit = async () => {
    if (!offer || !valid || chosen === null) {
      setError(t('tips.offer.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const started = await bffJson<TipStartedDTO>(`public/orders/${encodeURIComponent(token)}/tip`, {
        method: 'POST',
        body: JSON.stringify({ amountMinor: chosen, returnUrl: window.location.href.split('?')[0] }),
      });
      window.location.assign(started.session.redirectUrl);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
      setBusy(false);
    }
  };

  return (
    <Card title={t('tips.offer.title')} aria-label={t('tips.offer.title')} data-tip-card>
      {tip && (
        <p role="status" data-tip-state={tip.status}>
          {t(`tips.state.${tip.status}`, { amount: money(tip.amountMinor, tip.currency) })}
        </p>
      )}
      {offer && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="ui-caption">{t('tips.offer.intro', { recipient: offer.recipient })}</p>
          <fieldset className="flex flex-col gap-2">
            <legend className="ui-heading">{t('tips.offer.amounts')}</legend>
            <div className="flex flex-wrap gap-2">
              {offer.presetsMinor.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant={!custom.trim() && amount === preset ? 'solid' : 'outline'}
                  aria-pressed={!custom.trim() && amount === preset}
                  onClick={() => {
                    setAmount(preset);
                    setCustom('');
                  }}
                >
                  {money(preset, offer.currency)}
                </Button>
              ))}
            </div>
          </fieldset>
          <TextField
            label={t('tips.offer.custom')}
            inputMode="decimal"
            value={custom}
            placeholder={majorAmountText(offer.minMinor, offer.currency)}
            onChange={(event) => setCustom(event.target.value)}
            help={t('tips.offer.limits', {
              min: money(offer.minMinor, offer.currency),
              max: money(offer.maxMinor, offer.currency),
            })}
            error={error ?? undefined}
          />
          <div>
            <Button type="submit" disabled={busy || !valid}>
              {valid && chosen !== null
                ? t('tips.offer.submitAmount', { amount: money(chosen, offer.currency) })
                : t('tips.offer.submit')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
