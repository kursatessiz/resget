import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { formatMoney, majorAmountText, parseMajorAmount } from '@resget/shared';
import type { OrderTrackingDTO, TipStartedDTO } from '@resget/shared';
import { Body, Button, Caption, Card, Field, Notice } from '@/components/ui';
import { ApiError } from '@/lib/api';
import type { ApiClient } from '@/lib/api';
import { WEB_BASE_URL } from '@/lib/config';
import { deviceLocale, useT } from '@/lib/i18n';
import { useTheme } from '@/theme';

/**
 * The courier tip in the app (docs/BAHSIS.md), the same as on the web
 * tracking page: suggested amounts or one the customer types, paid on the
 * provider's hosted page in the browser. When the customer comes back to
 * the app the snapshot is read again, so the tip's state shows.
 */
export function TipCard({
  token,
  tracking,
  api,
  onReturn,
}: {
  token: string;
  tracking: OrderTrackingDTO;
  api: ApiClient;
  onReturn: () => unknown;
}) {
  const t = useT();
  const theme = useTheme();
  const locale = deviceLocale();
  const offer = tracking.tipOffer;
  const [amount, setAmount] = useState<number | null>(offer?.presetsMinor[1] ?? offer?.presetsMinor[0] ?? null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const awayForPayment = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && awayForPayment.current) {
        awayForPayment.current = false;
        setBusy(false);
        void onReturn();
      }
    });
    return () => subscription.remove();
  }, [onReturn]);

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
      const started = await api.request<TipStartedDTO>(`public/orders/${encodeURIComponent(token)}/tip`, {
        method: 'POST',
        auth: false,
        // The hosted page sends the customer back to the web tracking page; the app re-reads on return.
        body: { amountMinor: chosen, returnUrl: `${WEB_BASE_URL}/t/${encodeURIComponent(token)}` },
      });
      awayForPayment.current = true;
      await Linking.openURL(started.session.redirectUrl);
    } catch (err) {
      awayForPayment.current = false;
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network'));
      setBusy(false);
    }
  };

  return (
    <Card title={t('tips.offer.title')}>
      {tip && <Body>{t(`tips.state.${tip.status}`, { amount: money(tip.amountMinor, tip.currency) })}</Body>}
      {offer && (
        <>
          <Caption>{t('tips.offer.intro', { recipient: offer.recipient })}</Caption>
          <Body>{t('tips.offer.amounts')}</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] }}>
            {offer.presetsMinor.map((preset) => (
              <Button
                key={preset}
                label={money(preset, offer.currency)}
                variant={!custom.trim() && amount === preset ? 'solid' : 'outline'}
                tone={!custom.trim() && amount === preset ? 'theme' : 'muted'}
                onPress={() => {
                  setAmount(preset);
                  setCustom('');
                }}
              />
            ))}
          </View>
          <Field
            label={t('tips.offer.custom')}
            keyboardType="decimal-pad"
            value={custom}
            placeholder={majorAmountText(offer.minMinor, offer.currency)}
            onChangeText={setCustom}
          />
          <Caption>
            {t('tips.offer.limits', {
              min: money(offer.minMinor, offer.currency),
              max: money(offer.maxMinor, offer.currency),
            })}
          </Caption>
          {error && <Notice tone="error">{error}</Notice>}
          <Button
            label={
              valid && chosen !== null
                ? t('tips.offer.submitAmount', { amount: money(chosen, offer.currency) })
                : t('tips.offer.submit')
            }
            disabled={busy || !valid}
            onPress={() => void submit()}
          />
        </>
      )}
    </Card>
  );
}
