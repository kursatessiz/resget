import { NextRequest, NextResponse } from 'next/server';
import { safeLocalPath } from '@resget/shared';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, RESTAURANT_COOKIE } from '@/lib/session';

/** Clears the session cookies; works from a plain HTML form (no JavaScript needed). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData().catch(() => null);
  // Only a same-origin path may be the return target after signing out; anything else goes to the sign-in.
  const res = NextResponse.redirect(new URL(safeLocalPath(form?.get('next'), '/giris'), req.url), { status: 303 });
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, RESTAURANT_COOKIE]) {
    res.cookies.set(name, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  }
  return res;
}
