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

/**
 * Two jobs before a page renders:
 * - /panel: keep the access cookie fresh with the refresh cookie, or send
 *   the visitor to sign in. Server components then always see a valid token.
 * - /m: give an anonymous table QR visitor a session id so the funnel
 *   (docs/MASA_QR.md) can be measured; never anything identifying.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  const secure = process.env.NODE_ENV === 'production';

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

export const config = { matcher: ['/panel/:path*', '/admin/:path*', '/kayit', '/hesabim', '/m/:path*'] };
