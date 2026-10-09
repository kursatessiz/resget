import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ERROR_CODE_HEADER,
  InviteTokenSchema,
  PhoneSchema,
  QrScanSessionSchema,
  TableQrTokenSchema,
} from '@resget/shared';
import type { TokenPairDTO } from '@resget/shared';
import { apiInternalBaseUrl, forwardedFor, getServerEnv } from '@/lib/server-env';
import {
  ACCESS_TOKEN_COOKIE,
  QR_SESSION_COOKIE,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_TOKEN_COOKIE,
  sessionCookieOptions,
} from '@/lib/session';

const BodySchema = z
  .object({
    phone: PhoneSchema,
    code: z.string().regex(/^\d{6}$/),
    fullName: z.string().trim().min(2).max(120).optional(),
    qrToken: TableQrTokenSchema.optional(),
    inviteToken: InviteTokenSchema.optional(),
  })
  .strict();

/**
 * Exchanges the OTP for tokens and stores them in httpOnly cookies. The
 * tokens never reach the browser's JavaScript; the BFF and the middleware
 * read the cookies on the server.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: 'VALIDATION', message: 'Invalid request' }, { status: 400 });
  const qrSession = req.cookies.get(QR_SESSION_COOKIE)?.value;
  const upstream = await fetch(`${apiInternalBaseUrl()}/auth/otp/verify`, {
    method: 'POST',
    // The visitor's address, so the API's per-client sign-in limit counts this visitor, not the web server.
    headers: { 'content-type': 'application/json', ...forwardedFor(req.headers) },
    body: JSON.stringify({
      ...parsed.data,
      qrSessionId: parsed.data.qrToken && QrScanSessionSchema.safeParse(qrSession).success ? qrSession : undefined,
    }),
    cache: 'no-store',
  });
  if (!upstream.ok) {
    const body = await upstream.json().catch(() => ({ code: 'UNAUTHORIZED' }));
    const res = NextResponse.json(body, { status: upstream.status });
    const code = upstream.headers.get(ERROR_CODE_HEADER);
    if (code) res.headers.set(ERROR_CODE_HEADER, code);
    return res;
  }
  const tokens = (await upstream.json()) as TokenPairDTO;
  const secure = getServerEnv().NODE_ENV === 'production';
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, sessionCookieOptions(tokens.expiresInSeconds, secure));
  res.cookies.set(
    REFRESH_TOKEN_COOKIE,
    tokens.refreshToken,
    sessionCookieOptions(REFRESH_COOKIE_MAX_AGE_SECONDS, secure),
  );
  return res;
}
