import { NextRequest, NextResponse } from 'next/server';
import { HostnameSchema, type TokenPairDTO } from '@resget/shared';
import {
  ACCESS_TOKEN_COOKIE,
  QR_SESSION_COOKIE,
  QR_SESSION_MAX_AGE_SECONDS,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_TOKEN_COOKIE,
  accessTokenNeedsRefresh,
  sessionCookieOptions,
} from '@/lib/session';
import { BoundedTtlCache } from '@/lib/host-cache';
import { hostOf, isPlatformHost } from '@/lib/hosts';
import { contentSecurityPolicyHeader } from '@/lib/server-env';

/**
 * Which restaurant a custom host serves, remembered briefly so the home page does not ask the API on every hit.
 * Bounded: the key comes from the Host header of an anonymous request, so the cache never grows past
 * HOST_CACHE_MAX_ENTRIES and only syntactically valid host names are ever looked up or stored.
 */
const HOST_CACHE_MS = 60_000;
const HOST_CACHE_MAX_ENTRIES = 1000;
const hostCache = new BoundedTtlCache<string | null>(HOST_CACHE_MAX_ENTRIES, HOST_CACHE_MS);

/** Same syntax the API accepts for a custom domain (HostnameSchema, at most 253 characters). */
function isLookupableHost(host: string): boolean {
  const parsed = HostnameSchema.safeParse(host);
  return parsed.success && parsed.data === host;
}

async function slugForHost(host: string): Promise<string | null> {
  if (!isLookupableHost(host)) return null;
  const cached = hostCache.get(host);
  if (cached) return cached.value;
  const base = (process.env.API_INTERNAL_URL || 'http://localhost:4000').replace(/\/$/, '');
  const res = await fetch(`${base}/public/domains/resolve?host=${encodeURIComponent(host)}`, {
    cache: 'no-store',
  }).catch(() => null);
  const slug = res?.ok ? ((await res.json()) as { slug: string }).slug : null;
  hostCache.set(host, slug);
  return slug;
}

/**
 * Sets the Content-Security-Policy on every route. On SESSION_PATHS, three jobs before a page renders:
 * - /: on a restaurant's own domain (docs/VITRIN.md), show that restaurant's
 *   ordering page instead of the platform landing page.
 * Then:
 * - /panel: keep the access cookie fresh with the refresh cookie, or send
 *   the visitor to sign in. Server components then always see a valid token.
 * - /m: give an anonymous table QR visitor a session id so the funnel
 *   (docs/MASA_QR.md) can be measured; never anything identifying.
 * - /api/bff and /api/oauth: refresh the access cookie the same way, so a
 *   screen open longer than the access token lives (live streams reconnect
 *   when the token they were opened with expires, docs/SIPARIS_VE_SEVK.md)
 *   keeps working; without a session the API answers, never a redirect.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const res = SESSION_PATHS.some((pattern) => pattern.test(req.nextUrl.pathname))
    ? await sessionMiddleware(req)
    : NextResponse.next();
  // Every page carries the deployment's Content-Security-Policy (docs/GUVENLIK.md, "Görsel bağlantıları"); it is
  // built here at request time because next.config.ts headers are fixed when CI builds the image.
  res.headers.set('Content-Security-Policy', contentSecurityPolicyHeader());
  return res;
}

/** The paths the jobs below apply to; anything else only receives the security headers. */
const SESSION_PATHS: readonly RegExp[] = [
  /^\/$/,
  /^\/panel(?:\/|$)/,
  /^\/admin(?:\/|$)/,
  /^\/pazarlama(?:\/|$)/,
  /^\/kayit$/,
  /^\/hesabim$/,
  /^\/m(?:\/|$)/,
  /^\/api\/bff(?:\/|$)/,
  /^\/api\/oauth(?:\/|$)/,
];

async function sessionMiddleware(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  const secure = process.env.NODE_ENV === 'production';

  if (pathname === '/') {
    const host = hostOf(req.headers.get('host'));
    if (!host || isPlatformHost(host)) return NextResponse.next();
    const slug = await slugForHost(host);
    if (!slug) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = `/${slug}`;
    return NextResponse.rewrite(url);
  }

  if (pathname.startsWith('/m/')) {
    if (req.cookies.get(QR_SESSION_COOKIE)) return NextResponse.next();
    const res = NextResponse.next();
    res.cookies.set(QR_SESSION_COOKIE, crypto.randomUUID().replace(/-/g, ''), {
      ...sessionCookieOptions(QR_SESSION_MAX_AGE_SECONDS, secure),
    });
    return res;
  }

  const access = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessTokenNeedsRefresh(access)) return NextResponse.next();
  const apiRoute = pathname.startsWith('/api/');

  const refresh = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (refresh) {
    const base = (process.env.API_INTERNAL_URL || 'http://localhost:4000').replace(/\/$/, '');
    const upstream = await fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: 'no-store',
    }).catch(() => null);
    if (upstream?.ok) {
      const tokens = (await upstream.json()) as TokenPairDTO;
      // The page being rendered must see the new token too, not only the browser.
      const headers = new Headers(req.headers);
      const cookieHeader = req.headers.get('cookie') ?? '';
      headers.set(
        'cookie',
        [
          ...cookieHeader
            .split(';')
            .map((c) => c.trim())
            .filter((c) => c && !c.startsWith(`${ACCESS_TOKEN_COOKIE}=`)),
          `${ACCESS_TOKEN_COOKIE}=${tokens.accessToken}`,
        ].join('; '),
      );
      const res = NextResponse.next({ request: { headers } });
      res.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, sessionCookieOptions(tokens.expiresInSeconds, secure));
      res.cookies.set(
        REFRESH_TOKEN_COOKIE,
        tokens.refreshToken,
        sessionCookieOptions(REFRESH_COOKIE_MAX_AGE_SECONDS, secure),
      );
      return res;
    }
    // The API restarting or briefly unreachable is not a sign-out: the session cookies stay and the next
    // request tries the refresh again. Only a refresh the API refused ends the session.
    if (!upstream || upstream.status >= 500) return NextResponse.next();
  }

  if (apiRoute) {
    // The API answers a stale or missing token itself; a refused refresh still ends the session cookies.
    const res = NextResponse.next();
    if (refresh) {
      res.cookies.set(ACCESS_TOKEN_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
      res.cookies.set(REFRESH_TOKEN_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
    }
    return res;
  }

  const signIn = new URL('/giris', req.url);
  signIn.searchParams.set('next', `${pathname}${search}`);
  // A visitor opening the restaurant sign-up has no account yet: the sign-in asks for a name as well.
  if (pathname === '/kayit') signIn.searchParams.set('kayit', '1');
  const res = NextResponse.redirect(signIn);
  res.cookies.set(ACCESS_TOKEN_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  res.cookies.set(REFRESH_TOKEN_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}

export const config = {
  // Every route except Next.js build assets, so each page gets the Content-Security-Policy; the session jobs above
  // still run only on SESSION_PATHS.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
