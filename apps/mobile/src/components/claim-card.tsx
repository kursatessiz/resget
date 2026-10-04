import { useState } from 'react';
import { View } from 'react-native';
import { CLAIM_NOTE_MAX, formatMoney } from '@resget/shared';
import type { OrderTrackingDTO, RefundItem } from '@resget/shared';
import { Body, Button, Caption, Card, Field, Notice } from '@/components/ui';
import { ApiError } from '@/lib/api';
import type { ApiClient } from '@/lib/api';
import { deviceLocale, useT } from '@/lib/i18n';
import { useTheme } from '@/theme';

/**
 * The customer's missing-item report in the app (docs/ODEME.md, "Eksik
 * ürün bildirimi"), the same as on the web tracking page: which items did
 * not arrive and how many, an optional note, then the restaurant's decision.
 */
export function ClaimCard({
  token,
  tracking,
  api,
  onUpdated,
}: {
  token: string;
  tracking: OrderTrackingDTO;
  api: ApiClient;
  onUpdated: (next: OrderTrackingDTO) => void;
}) {
  const t = useT();
  const theme = useTheme();
  const locale = deviceLocale();
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { claim } = tracking;
  if (!claim && !tracking.canClaim) return null;
  const items: RefundItem[] = Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.request<OrderTrackingDTO>(`public/orders/${encodeURIComponent(token)}/claims`, {
        method: 'POST',
        auth: false,
        body: { items, ...(note.trim() ? { note: note.trim() } : {}) },
      });
      onUpdated(next);
      setOpen(false);
      setQuantities({});
      setNote('');
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('tracking.claim.title')}>
      {claim && (
        <Body>
          {claim.status === 'OPEN'
            ? t('tracking.claim.open')
            : claim.status === 'APPROVED'
              ? t('tracking.claim.approved', {
                  amount: formatMoney({ amountMinor: claim.refundedMinor, currency: claim.currency }, locale),
                })
              : t('tracking.claim.declined', { reason: claim.declineReason ?? '' })}
        </Body>
      )}
      {tracking.canClaim && !open && (
        <Button label={t('tracking.claim.start')} variant="outline" tone="theme" onPress={() => setOpen(true)} />
      )}
      {tracking.canClaim && open && (
        <>
          <Caption>{t('tracking.claim.intro')}</Caption>
          {tracking.items.map((item) => {
            const left = item.quantity - item.refundedQuantity;
            if (left <= 0) return null;
            const chosen = quantities[item.id] ?? 0;
            const set = (value: number) => setQuantities({ ...quantities, [item.id]: value });
            return (
              <View key={item.id} style={{ gap: theme.spacing[2] }}>
                <Body>{t('tracking.claim.itemQuantity', { name: item.name, left })}</Body>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] }}>
                  <Button
                    label={t('mobile.stepper.minus')}
                    variant="outline"
                    tone="muted"
                    disabled={chosen === 0}
                    onPress={() => set(chosen - 1)}
                  />
                  <Body>{String(chosen)}</Body>
                  <Button
                    label={t('mobile.stepper.plus')}
                    variant="outline"
                    tone="muted"
                    disabled={chosen >= left}
                    onPress={() => set(chosen + 1)}
                  />
                </View>
              </View>
            );
          })}
          <Field
            label={t('tracking.claim.note')}
            value={note}
            onChangeText={setNote}
            maxLength={CLAIM_NOTE_MAX}
            multiline
          />
          {error && <Notice tone="error">{error}</Notice>}
          <Button
            label={t('tracking.claim.submit')}
            onPress={() => void submit()}
            busy={busy}
            disabled={items.length === 0}
          />
          <Button label={t('common.cancel')} variant="outline" tone="muted" onPress={() => setOpen(false)} />
        </>
      )}
    </Card>
  );
}
