import { Linking } from 'react-native';
import { sessionHandoffUrl, stripTrailingSlashes } from '@resget/shared';
import type { SessionHandoffDTO } from '@resget/shared';
import type { ApiClient } from './api';
import { WEB_BASE_URL } from './config';

/** The address that opens `path` on the web: through the one-time handoff when a code was issued, plain otherwise. */
export function webPageUrl(webBaseUrl: string, path: string, code: string | null): string {
  return code ? sessionHandoffUrl(webBaseUrl, code, path) : `${stripTrailingSlashes(webBaseUrl)}${path}`;
}

/**
 * Opens a web page in the browser with the app's session (docs/GUVENLIK.md,
 * "Uygulamadan web'e oturum aktarımı"), so the customer arrives signed in and
 * their wallet cards are offered at payment. Without a code the page opens
 * signed out and the customer can sign in there.
 */
export async function openWebPage(api: ApiClient, path: string): Promise<void> {
  const code = await api
    .request<SessionHandoffDTO>('auth/handoff', { method: 'POST' })
    .then((handoff) => handoff.code)
    .catch(() => null);
  await Linking.openURL(webPageUrl(WEB_BASE_URL, path, code));
}
