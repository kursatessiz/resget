import { Redirect, Tabs } from 'expo-router';
import { useT } from '@/lib/i18n';
import { tabsFor } from '@/lib/tabs';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme';

/** Tabs come from the member's permissions in the chosen restaurant; nothing is hard-coded per role. */
export default function AppLayout() {
  const t = useT();
  const theme = useTheme();
  const { ready, me, membership } = useSession();
  if (!ready) return null;
  if (!me) return <Redirect href="/giris" />;
  const tabs = tabsFor(membership?.permissions ?? [], membership?.features ?? []);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.theme,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
      }}
    >
      <Tabs.Screen
        name="kurye"
        options={{ title: t('mobile.tabs.courier'), href: tabs.includes('courier') ? undefined : null }}
      />
      <Tabs.Screen
        name="sevk"
        options={{ title: t('mobile.tabs.dispatch'), href: tabs.includes('dispatch') ? undefined : null }}
      />
      <Tabs.Screen
        name="siparisler"
        options={{ title: t('mobile.tabs.orders'), href: tabs.includes('orders') ? undefined : null }}
      />
      <Tabs.Screen name="siparislerim" options={{ title: t('mobile.tabs.myOrders') }} />
      <Tabs.Screen name="hesap" options={{ title: t('mobile.tabs.account') }} />
    </Tabs>
  );
}
