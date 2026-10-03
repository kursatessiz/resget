import { NextRequest, NextResponse } from 'next/server';
import { ERROR_CODE_HEADER, REQUEST_ID_HEADER } from '@resget/shared';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { ACCESS_TOKEN_COOKIE } from '@/lib/session';

/**
 * Backend-for-frontend proxy: every `/api/bff/<path>` call from the browser
 * is forwarded to the API at a fixed, server-only base URL. The access token
 * travels in an httpOnly cookie, never in browser storage. Session cookies
 * are set by the sign-in flow (backlog item A2); until then the bearer header
 * of the request is forwarded as is.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'cookie',
]);

function sanitizePath(segments: string[]): string | null {
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[\\%]/.test(segment)) return null;
  }
  return segments.map(encodeURIComponent).join('/');
}

async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await context.params;
  const apiPath = sanitizePath(path);
  if (!apiPath) return NextResponse.json({ code: 'VALIDATION', message: 'Invalid path' }, { status: 400 });

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  headers.set(REQUEST_ID_HEADER, requestId);
  const token = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  const upstream = await fetch(`${apiInternalBaseUrl()}/${apiPath}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });

  // The body is passed through as a stream, so server-sent events (order
  // tracking, dispatch board) flow to the browser as the API emits them.
  const res = new NextResponse(upstream.status === 204 ? null : upstream.body, { status: upstream.status });
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.headers.set('content-type', contentType);
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) res.headers.set('content-disposition', disposition);
  if (contentType?.startsWith('text/event-stream')) {
    res.headers.set('cache-control', 'no-cache, no-transform');
    res.headers.set('x-accel-buffering', 'no');
  }
  res.headers.set(REQUEST_ID_HEADER, requestId);
  const errorCode = upstream.headers.get(ERROR_CODE_HEADER);
  if (errorCode) res.headers.set(ERROR_CODE_HEADER, errorCode);
  return res;
}

export const dynamic = 'force-dynamic';

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
