import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Static configuration lives in app.json; this adds what depends on the
 * deployment: the public web host whose tracking links (`/t/<token>`) open
 * in the app. Only an https host is registered, so a local development URL
 * leaves the links to the browser.
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

export default ({ config }: ConfigContext): ExpoConfig => {
  const host = webHost();
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
  };
};
