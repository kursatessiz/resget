import { NextRequest, NextResponse } from 'next/server';
import { safeLocalPath } from '@resget/shared';
import { apiInternalBaseUrl, forwardedFor } from '@/lib/server-env';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, RESTAURANT_COOKIE } from '@/lib/session';

/**
 * Signs out: the API ends the session first (docs/GUVENLIK.md "Oturumlar"), so a copy of the refresh
 * token is worth nothing afterwards, then the cookies are cleared. Works from a plain HTML form (no
 * JavaScript needed). The API being unreachable does not keep the person signed in on this browser.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData().catch(() => null);
  const access = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (access || refresh) {
    // The access token names the session; the refresh token does once the access token has lapsed.
    await fetch(`${apiInternalBaseUrl()}/auth/logout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(access ? { authorization: `Bearer ${access}` } : {}),
        ...forwardedFor(req.headers),
      },
      body: JSON.stringify(refresh ? { refreshToken: refresh } : {}),
      cache: 'no-store',
    }).catch(() => null);
  }
  // Only a same-origin path may be the return target after signing out; anything else goes to the sign-in.
  const res = NextResponse.redirect(new URL(safeLocalPath(form?.get('next'), '/giris'), req.url), { status: 303 });
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, RESTAURANT_COOKIE]) {
    res.cookies.set(name, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  }
  return res;
}
