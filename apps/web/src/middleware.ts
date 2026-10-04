import { NextRequest, NextResponse } from 'next/server';
import type { TokenPairDTO } from '@resget/shared';
import {
  ACCESS_TOKEN_COOKIE,
  QR_SESSION_COOKIE,
  QR_SESSION_MAX_AGE_SECONDS,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_TOKEN_COOKIE,
  accessTokenNeedsRefresh,
  sessionCookieOptions,
} from '@/lib/session';

/** Hosts that are the platform itself; everything else that reaches us is a restaurant's custom domain. */
function isPlatformHost(host: string): boolean {
  const platform = (process.env.WEB_DOMAIN ?? '').toLowerCase();
  return host === platform || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}

/** Which restaurant a custom host serves, remembered briefly so the home page does not ask the API on every hit. */
const hostCache = new Map<string, { slug: string | null; until: number }>();
const HOST_CACHE_MS = 60_000;
async function slugForHost(host: string): Promise<string | null> {
  const cached = hostCache.get(host);
  if (cached && cached.until > Date.now()) return cached.slug;
  const base = (process.env.API_INTERNAL_URL || 'http://localhost:4000').replace(/\/$/, '');
  const res = await fetch(`${base}/public/domains/resolve?host=${encodeURIComponent(host)}`, {
    cache: 'no-store',
  }).catch(() => null);
  const slug = res?.ok ? ((await res.json()) as { slug: string }).slug : null;
  hostCache.set(host, { slug, until: Date.now() + HOST_CACHE_MS });
  return slug;
}

/**
 * Three jobs before a page renders:
 * - /: on a restaurant's own domain (docs/VITRIN.md), show that restaurant's
 *   ordering page instead of the platform landing page.
 * Two jobs after that:
 * - /panel: keep the access cookie fresh with the refresh cookie, or send
 *   the visitor to sign in. Server components then always see a valid token.
 * - /m: give an anonymous table QR visitor a session id so the funnel
 *   (docs/MASA_QR.md) can be measured; never anything identifying.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  const secure = process.env.NODE_ENV === 'production';

  if (pathname === '/') {
    const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
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
  matcher: ['/', '/panel/:path*', '/admin/:path*', '/pazarlama/:path*', '/kayit', '/hesabim', '/m/:path*'],
};
