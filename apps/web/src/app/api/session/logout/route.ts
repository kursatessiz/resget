import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, RESTAURANT_COOKIE } from '@/lib/session';

/** Only a same-origin path may be the return target after signing out; anything else goes to the sign-in. */
function safeNext(value: FormDataEntryValue | null): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/giris';
}

/** Clears the session cookies; works from a plain HTML form (no JavaScript needed). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData().catch(() => null);
  const res = NextResponse.redirect(new URL(safeNext(form?.get('next') ?? null), req.url), { status: 303 });
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, RESTAURANT_COOKIE]) {
    res.cookies.set(name, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  }
  return res;
}
