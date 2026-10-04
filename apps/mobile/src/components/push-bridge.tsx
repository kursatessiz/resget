import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { listenForNotificationTaps, registerPushDevice } from '@/lib/push';
import { useSession } from '@/state/session';

/** Registers the phone once a person is signed in and routes notification taps into the app. */
export function PushBridge() {
  const router = useRouter();
  const { me, api } = useSession();

  useEffect(() => {
    if (!me) return;
    void registerPushDevice(api);
  }, [api, me]);

  useEffect(() => listenForNotificationTaps((route) => router.push(route as never)), [router]);

  return null;
}
