/**
 * Browser-binding checks for the routes that set a session (docs/GUVENLIK.md "Oturum kurma"). A request
 * another site started must never put a session into this browser (login CSRF): browsers say who started
 * a request in Sec-Fetch-Site and, for anything but a plain navigation, in Origin.
 */

/** Sec-Fetch-Site values a session route accepts: a fetch from this site's own pages ... */
export const SAME_ORIGIN_ONLY = ['same-origin'] as const;
/** ... or, for a top-level navigation the app itself opens, a request no page started (`none`). */
export const SAME_ORIGIN_OR_DIRECT = ['same-origin', 'none'] as const;

/** The host this request was addressed to, as the browser saw it (Caddy keeps the Host header). */
function ownHost(headers: Pick<Headers, 'get'>, fallback: string): string {
  return (headers.get('host') ?? fallback).toLowerCase();
}

/**
 * True when another site started this request: Sec-Fetch-Site names anything outside `allowed`, or an
 * Origin is present and is not this host. Requests that carry neither header (non-browser clients) cannot
 * be forged from a victim's browser and pass.
 */
export function isForeignRequest(
  headers: Pick<Headers, 'get'>,
  requestHost: string,
  allowed: readonly string[],
): boolean {
  const site = headers.get('sec-fetch-site');
  if (site !== null && !allowed.includes(site.toLowerCase())) return true;
  const origin = headers.get('origin');
  if (origin === null) return false;
  try {
    return new URL(origin).host.toLowerCase() !== ownHost(headers, requestHost);
  } catch {
    // 'null' (sandboxed frames, some redirects) or garbage: not this site.
    return true;
  }
}

/** True when the body is declared as JSON; a text/plain form cannot then smuggle a JSON body in. */
export function isJsonRequest(headers: Pick<Headers, 'get'>): boolean {
  const type = headers.get('content-type');
  return type !== null && type.split(';')[0].trim().toLowerCase() === 'application/json';
}
