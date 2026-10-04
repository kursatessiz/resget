import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { tabsFor } from '@/lib/tabs';
import { useSession } from '@/state/session';

const TAB_ROUTES = {
  courier: '/(app)/kurye',
  dispatch: '/(app)/sevk',
  orders: '/(app)/siparisler',
  myOrders: '/(app)/siparislerim',
  account: '/(app)/hesap',
} as const;

/** Entry: wait for the stored session, then sign-in or the role tabs. */
export default function Index() {
  const { ready, me, membership } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!me) return <Redirect href="/giris" />;
  return <Redirect href={TAB_ROUTES[tabsFor(membership?.permissions ?? [], membership?.features ?? [])[0]]} />;
}
