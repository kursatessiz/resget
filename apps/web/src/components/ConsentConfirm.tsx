'use client';

import { useState } from 'react';
import type { ConsentConfirmResultDTO } from '@resget/shared';
import { Button } from '@/components/ui';
import { bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

export function ConsentConfirm({ token, locale }: { token: string; locale: string }) {
  const t = useT(locale);
  const [result, setResult] = useState<ConsentConfirmResultDTO | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      setResult(await bffJson<ConsentConfirmResultDTO>(`public/consent/confirm/${token}`, { method: 'POST' }));
    } catch {
      setResult({ status: 'INVALID' });
    } finally {
      setBusy(false);
    }
  };

  if (result?.status === 'CONFIRMED')
    return <p role="status">{t('consent.confirm.done', { restaurant: result.restaurantName })}</p>;
  if (result?.status === 'INVALID') return <p role="status">{t('consent.confirm.invalid')}</p>;
  return (
    <div>
      <Button onClick={() => void confirm()} disabled={busy}>
        {t('consent.confirm.button')}
      </Button>
    </div>
  );
}
