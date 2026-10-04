import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { isExpoPushToken, pushRouteFor } from '@resget/shared';
import type { ApiClient } from './api';
import { APP_VERSION } from './config';
import { deviceLocale, translatorFor } from './i18n';

/**
 * Push registration (docs/MESAJLASMA.md, docs/MOBIL.md): the device token
 * is handed to the API after sign-in and removed at sign-out. The same
 * phone receives customer, courier and staff notifications; the API decides
 * which, from the person's role at that moment. Nothing here throws: a
 * phone without push still works.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registeredToken: string | null = null;

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/** Asks once, fetches the Expo token and registers it; returns the token or null when the phone cannot push. */
export async function registerPushDevice(api: ApiClient): Promise<string | null> {
  if (!Device.isDevice) return null;
  try {
    if (Platform.OS === 'android') {
      const t = translatorFor(deviceLocale());
      await Notifications.setNotificationChannelAsync('default', {
        name: t('mobile.push.channel'),
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const status = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!status.granted) return null;
    const id = projectId();
    const token = (await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : undefined)).data;
    if (!isExpoPushToken(token)) return null;
    await api.request('me/devices', {
      method: 'POST',
      body: {
        platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
        token,
        appVersion: APP_VERSION,
        locale: deviceLocale(),
      },
    });
    registeredToken = token;
    return token;
  } catch {
    return null;
  }
}

/** Removes this phone from the account before the tokens are dropped, so no later update lands here. */
export async function unregisterPushDevice(api: ApiClient): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  try {
    await api.request(`me/devices/${encodeURIComponent(token)}`, { method: 'DELETE' });
  } catch {
    // The API disables a dead token on its own the next time it tries it.
  }
}

/** The in-app route a tapped notification asks for, or null. */
export function routeForResponse(response: Notifications.NotificationResponse | null): string | null {
  if (!response) return null;
  return pushRouteFor(response.notification.request.content.data);
}

/** Calls `open` for the notification that launched the app and for every tap while it runs. */
export function listenForNotificationTaps(open: (route: string) => void): () => void {
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    const route = routeForResponse(response);
    if (route) open(route);
  });
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const route = routeForResponse(response);
    if (route) open(route);
  });
  return () => subscription.remove();
}
