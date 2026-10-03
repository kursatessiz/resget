'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_LOCALE, BUNDLED_MESSAGES, ERROR_CODE_HEADER, createTranslator } from '@resget/shared';
import { Button, TextField } from '@/components/ui';

type Step = 'phone' | 'code';

/**
 * Phone plus one-time code (docs/MIMARI.md "Oturum"). The code request goes
 * through the BFF; the verification goes to a route handler that stores the
 * tokens in httpOnly cookies, so nothing secret ever reaches this component.
 */
export function SignInForm({
  locale,
  next,
  register,
  qrToken,
  inviteToken = null,
}: {
  locale: string;
  next: string;
  /** Guest registration from a table QR: asks for a name and records the funnel step. */
  register: boolean;
  qrToken: string | null;
  /** Staff invite: accepted by the API in the same step as the sign-in. */
  inviteToken?: string | null;
}) {
  const router = useRouter();
  const t = useMemo(
    () =>
      createTranslator({
        locale,
        messages: BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE],
        fallback: BUNDLED_MESSAGES[BASE_LOCALE],
      }),
    [locale],
  );
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const errorMessage = (res: Response, fallbackKey: string): string => {
    const codeHeader = res.headers.get(ERROR_CODE_HEADER);
    if (codeHeader === 'RATE_LIMITED') return t('auth.otp.tooMany');
    if (codeHeader === 'UNAUTHORIZED') return t('auth.otp.invalid');
    if (codeHeader) return t(`errors.${codeHeader}`);
    return t(fallbackKey);
  };

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/bff/auth/otp/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        setError(errorMessage(res, 'common.error.generic'));
        return;
      }
      setNotice(t('auth.otp.sentTo', { phone }));
      setStep('code');
    } catch {
      setError(t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/session/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone,
          code,
          fullName: register && fullName.trim() ? fullName.trim() : undefined,
          qrToken: register && qrToken ? qrToken : undefined,
          inviteToken: inviteToken ?? undefined,
        }),
      });
      if (!res.ok) {
        setError(errorMessage(res, 'auth.otp.invalid'));
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError(t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'phone') {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void requestCode();
        }}
      >
        {register && (
          <TextField
            id="fullName"
            name="fullName"
            label={t('auth.name.label')}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
            required
          />
        )}
        <TextField
          id="phone"
          name="phone"
          type="tel"
          label={t('auth.phone.label')}
          help={t('auth.phone.help')}
          placeholder={t('auth.phone.placeholder')}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          autoComplete="tel"
          inputMode="tel"
          required
          error={error}
        />
        <Button type="submit" disabled={busy} block>
          {t('auth.otp.send')}
        </Button>
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void verify();
      }}
    >
      {notice && <p className="ui-text-muted">{notice}</p>}
      <TextField
        id="code"
        name="code"
        label={t('auth.otp.label')}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        required
        error={error}
      />
      <Button type="submit" disabled={busy || code.length !== 6} block>
        {t('auth.otp.verify')}
      </Button>
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="link" tone="muted" onClick={() => void requestCode()} disabled={busy}>
          {t('auth.otp.resend')}
        </Button>
        <Button type="button" variant="link" tone="muted" onClick={() => setStep('phone')} disabled={busy}>
          {t('auth.otp.changePhone')}
        </Button>
      </div>
    </form>
  );
}
