import { useState } from 'react';
import { useRouter } from 'expo-router';
import type { TokenPairDTO } from '@resget/shared';
import { Body, Button, Card, Field, Notice, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession } from '@/state/session';

/** Phone and one-time code, the same OTP flow as the web (docs/MOBIL.md). */
export default function SignIn() {
  const t = useT();
  const router = useRouter();
  const { api, signIn } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network'));
    } finally {
      setBusy(false);
    }
  };

  const requestCode = () =>
    run(async () => {
      await api.request('auth/otp/request', { method: 'POST', body: { phone: phone.trim() }, auth: false });
      setSent(true);
    });
  const verify = () =>
    run(async () => {
      const tokens = await api.request<TokenPairDTO>('auth/otp/verify', {
        method: 'POST',
        body: { phone: phone.trim(), code: code.trim() },
        auth: false,
      });
      await signIn(tokens);
      router.replace('/');
    });

  return (
    <Screen>
      <Title>{t('mobile.signIn.title')}</Title>
      <Body muted>{t('mobile.signIn.intro')}</Body>
      <Card>
        <Field
          label={t('mobile.signIn.phone')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoComplete="tel"
          editable={!sent}
        />
        {!sent && (
          <Button
            label={t('mobile.signIn.sendCode')}
            onPress={requestCode}
            busy={busy}
            disabled={phone.trim().length < 10}
          />
        )}
        {sent && (
          <>
            <Notice tone="success">{t('mobile.signIn.codeSent')}</Notice>
            <Field
              label={t('mobile.signIn.code')}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
            />
            <Button label={t('mobile.signIn.verify')} onPress={verify} busy={busy} disabled={code.trim().length < 6} />
            <Button
              label={t('mobile.signIn.changePhone')}
              onPress={() => {
                setSent(false);
                setCode('');
              }}
              variant="outline"
              tone="muted"
            />
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </Card>
    </Screen>
  );
}
