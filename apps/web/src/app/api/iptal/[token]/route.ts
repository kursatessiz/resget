import { NextRequest, NextResponse } from 'next/server';
import { UuidSchema } from '@resget/shared';
import { apiInternalBaseUrl, forwardedFor } from '@/lib/server-env';

/**
 * The List-Unsubscribe address of campaign emails (docs/EPOSTA.md). A mail
 * client's one-click POST (RFC 8058) opts out without a page; opening the
 * address in a browser goes to the opt-out page, which does the same.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await context.params;
  if (!UuidSchema.safeParse(token).success) return new NextResponse(null, { status: 404 });
  const res = await fetch(`${apiInternalBaseUrl()}/public/marketing/opt-out/${token}`, {
    method: 'POST',
    headers: forwardedFor(req.headers),
    cache: 'no-store',
  });
  return new NextResponse(null, { status: res.ok ? 200 : res.status === 404 ? 404 : 502 });
}

export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await context.params;
  if (!UuidSchema.safeParse(token).success) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(new URL(`/iptal/${token}`, req.url), 303);
}
