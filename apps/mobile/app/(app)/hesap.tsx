import { useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Body, Button, Caption, Card, Notice, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { APP_VERSION } from '@/lib/config';
import { useT } from '@/lib/i18n';
import { stopTracking } from '@/lib/location-tracker';
import { unregisterPushDevice } from '@/lib/push';
import { useSession } from '@/state/session';

/** Who is signed in, which restaurant the app works in, and the switcher between memberships. */
export default function Account() {
  const t = useT();
  const router = useRouter();
  const { me, membership, chooseRestaurant, signOut, api } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const active = me.memberships.filter((m) => m.status === 'ACTIVE');
  const leave = () =>
    Promise.all([stopTracking(), unregisterPushDevice(api)]).finally(() =>
      signOut().then(() => router.replace('/giris')),
    );

  /** Deletion from inside the app (store rules; docs/KISISEL_VERI.md): confirmed twice, then the session ends. */
  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      await stopTracking();
      await unregisterPushDevice(api);
      await api.request<void>('me/account/delete', { method: 'POST', body: { confirm: true } });
      await signOut();
      router.replace('/giris');
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network'));
    } finally {
      setBusy(false);
    }
  };
  const confirmDelete = () =>
    Alert.alert(
      t('account.privacy.deleteTitle'),
      `${t('account.privacy.deleteErased')}\n\n${t('account.privacy.deleteKept')}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('account.privacy.deleteNow'), style: 'destructive', onPress: () => void deleteAccount() },
      ],
    );
  return (
    <Screen>
      <Title>{t('mobile.account.title')}</Title>
      <Body>{t('mobile.account.signedInAs', { name: me.user.fullName, phone: me.user.phone })}</Body>
      <Card title={t('mobile.switcher.title')}>
        {active.length === 0 && <Body muted>{t('mobile.signIn.noMembership')}</Body>}
        {active.map((m) => (
          <Button
            key={m.membershipId}
            label={`${m.restaurantName} (${m.roleName})`}
            onPress={() => void chooseRestaurant(m.restaurantId)}
            variant={m.restaurantId === membership?.restaurantId ? 'solid' : 'outline'}
            tone={m.restaurantId === membership?.restaurantId ? 'theme' : 'muted'}
          />
        ))}
      </Card>
      <Button label={t('mobile.switcher.signOut')} variant="outline" tone="warn" onPress={() => void leave()} />
      <Card title={t('account.privacy.title')}>
        <Body muted>{t('mobile.account.deleteIntro')}</Body>
        {error && <Notice tone="error">{error}</Notice>}
        <Button
          label={t('account.privacy.delete')}
          variant="outline"
          tone="error"
          disabled={busy}
          onPress={confirmDelete}
        />
      </Card>
      <Caption>{t('mobile.account.version', { version: APP_VERSION })}</Caption>
    </Screen>
  );
}
