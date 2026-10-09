import { NextRequest, NextResponse } from 'next/server';
import { SessionHandoffCodeSchema, safeLocalPath } from '@resget/shared';
import type { TokenPairDTO } from '@resget/shared';
import { apiInternalBaseUrl, forwardedFor, getServerEnv } from '@/lib/server-env';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_TOKEN_COOKIE,
  sessionCookieOptions,
} from '@/lib/session';

/**
 * The mobile app opens a page with its session (docs/GUVENLIK.md): the
 * one-time code becomes this browser's httpOnly session cookies and the
 * visitor lands on `next`. The address carrying the code is never rendered
 * as a page. A refused code still goes to `next`, signed out.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const next = safeLocalPath(req.nextUrl.searchParams.get('next'), '/');
  const res = NextResponse.redirect(new URL(next, req.url), { status: 303 });
  res.headers.set('cache-control', 'no-store');
  res.headers.set('referrer-policy', 'no-referrer');
  const code = SessionHandoffCodeSchema.safeParse(req.nextUrl.searchParams.get('code'));
  if (!code.success) return res;
  const upstream = await fetch(`${apiInternalBaseUrl()}/auth/handoff/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...forwardedFor(req.headers) },
    body: JSON.stringify({ code: code.data }),
    cache: 'no-store',
  }).catch(() => null);
  if (!upstream?.ok) return res;
  const tokens = (await upstream.json()) as TokenPairDTO;
  const secure = getServerEnv().NODE_ENV === 'production';
  res.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, sessionCookieOptions(tokens.expiresInSeconds, secure));
  res.cookies.set(
    REFRESH_TOKEN_COOKIE,
    tokens.refreshToken,
    sessionCookieOptions(REFRESH_COOKIE_MAX_AGE_SECONDS, secure),
  );
  return res;
}
