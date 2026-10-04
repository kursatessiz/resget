import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Static configuration lives in app.json; this adds what depends on the
 * deployment: the public web host whose tracking links (`/t/<token>`) open
 * in the app, and the Google Maps key the Android build draws the courier
 * map with (docs/MOBIL.md, "Kurye haritası"). Only an https host is
 * registered, so a local development URL leaves the links to the browser.
 * The maps key comes from the EAS environment, never from the repository;
 * without it the Android app hands every stop to the phone's maps app.
 */
function webHost(): string | null {
  const web = process.env.EXPO_PUBLIC_WEB_URL;
  if (!web) return null;
  try {
    const url = new URL(web);
    return url.protocol === 'https:' ? url.host : null;
  } catch {
    return null;
  }
}

function androidMapsKey(): string | null {
  const key = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim();
  return key ? key : null;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const host = webHost();
  const mapsKey = androidMapsKey();
  return {
    ...config,
    name: config.name ?? 'Resget',
    slug: config.slug ?? 'resget',
    ios: { ...config.ios, ...(host ? { associatedDomains: [`applinks:${host}`] } : {}) },
    android: {
      ...config.android,
      ...(host
        ? {
            intentFilters: [
              {
                action: 'VIEW',
                autoVerify: true,
                data: [{ scheme: 'https', host, pathPrefix: '/t/' }],
                category: ['BROWSABLE', 'DEFAULT'],
              },
            ],
          }
        : {}),
    },
    plugins: [...(config.plugins ?? []), ['react-native-maps', mapsKey ? { androidGoogleMapsApiKey: mapsKey } : {}]],
    extra: { ...config.extra, androidMapsKeyConfigured: mapsKey !== null },
  };
};
