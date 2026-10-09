import { getServerEnv } from './server-env';

/**
 * Universal link files for the mobile app (docs/MOBIL.md, section 4): iOS
 * reads /.well-known/apple-app-site-association, Android reads
 * /.well-known/assetlinks.json. Both are built from the deployment's store
 * identifiers at request time; while those are unset the files are absent
 * (404) and tracking and app return links simply open in the browser.
 */
export function appleAppSiteAssociation(): Record<string, unknown> | null {
  const env = getServerEnv();
  if (!env.IOS_APP_IDENTIFIER) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: [env.IOS_APP_IDENTIFIER],
          components: [
            { '/': '/t/*', comment: 'Order tracking links' },
            { '/': '/uygulama/*', comment: 'Returns to the app, such as wallet linking' },
          ],
        },
      ],
    },
  };
}

export function androidAssetLinks(): Record<string, unknown>[] | null {
  const env = getServerEnv();
  if (env.ANDROID_CERT_FINGERPRINTS.length === 0) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: env.ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: env.ANDROID_CERT_FINGERPRINTS,
      },
    },
  ];
}
