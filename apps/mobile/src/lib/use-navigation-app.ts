import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { readNavigationApp, writeNavigationApp } from './session';
import { navigationAppsFor, resolveNavigationApp } from './trip-map';
import type { NavigationApp } from './trip-map';

/** The maps app directions open in, re-read whenever the screen comes back into view. */
export function useNavigationApp(): {
  app: NavigationApp;
  options: NavigationApp[];
  choose: (app: NavigationApp) => void;
} {
  const [app, setApp] = useState<NavigationApp>(() => resolveNavigationApp(null, Platform.OS));
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void readNavigationApp().then((stored) => {
        if (live) setApp(resolveNavigationApp(stored, Platform.OS));
      });
      return () => {
        live = false;
      };
    }, []),
  );
  const choose = useCallback((next: NavigationApp) => {
    setApp(next);
    void writeNavigationApp(next);
  }, []);
  return { app, options: navigationAppsFor(Platform.OS), choose };
}
