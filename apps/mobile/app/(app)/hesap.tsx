import { useRouter } from 'expo-router';
import { Body, Button, Caption, Card, Screen, Title } from '@/components/ui';
import { APP_VERSION } from '@/lib/config';
import { useT } from '@/lib/i18n';
import { stopTracking } from '@/lib/location-tracker';
import { useSession } from '@/state/session';

/** Who is signed in, which restaurant the app works in, and the switcher between memberships. */
export default function Account() {
  const t = useT();
  const router = useRouter();
  const { me, membership, chooseRestaurant, signOut } = useSession();
  if (!me) return null;
  const active = me.memberships.filter((m) => m.status === 'ACTIVE');
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
      <Button
        label={t('mobile.switcher.signOut')}
        variant="outline"
        tone="warn"
        onPress={() => {
          void stopTracking().finally(() => signOut().then(() => router.replace('/giris')));
        }}
      />
      <Caption>{t('mobile.account.version', { version: APP_VERSION })}</Caption>
    </Screen>
  );
}
