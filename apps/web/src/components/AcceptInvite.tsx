'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { InviteAcceptedDTO } from '@resget/shared';
import { Button } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** One-click accept for a signed-in user; a mismatched phone shows the reason and a way to switch accounts. */
export function AcceptInvite({
  token,
  locale,
  phone,
  next,
}: {
  token: string;
  locale: string;
  phone: string;
  next: string;
}) {
  const t = useT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await bffJson<InviteAcceptedDTO>(`me/invites/${token}/accept`, { method: 'POST' });
      setDone(true);
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="ui-caption">{t('staff.join.signedInAs', { phone })}</p>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      {done ? (
        <p className="ui-text-muted">{t('staff.join.accepted')}</p>
      ) : (
        <Button onClick={() => void accept()} disabled={busy} block>
          {t('staff.join.accept')}
        </Button>
      )}
      <form method="post" action="/api/session/logout">
        <input type="hidden" name="next" value={`/j/${token}`} />
        <Button type="submit" variant="link" tone="muted">
          {t('staff.join.switchAccount')}
        </Button>
      </form>
    </div>
  );
}
