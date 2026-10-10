import { NextRequest, NextResponse } from 'next/server';
import { CompleteMetaConnectSchema, OAUTH_RESULTS, OAUTH_RETURN_PATH_PATTERN } from '@resget/shared';
import type { OAuthCompleteDTO, OAuthResult } from '@resget/shared';
import { apiInternalBaseUrl, forwardedFor } from '@/lib/server-env';
import { ACCESS_TOKEN_COOKIE } from '@/lib/session';

const FAILED: OAuthCompleteDTO = { returnPath: '/panel', result: 'error' };

/** A query value Meta sent once; a missing or repeated one counts as absent. */
function single(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

/**
 * Where Meta sends the browser back after consent (docs/ENTEGRASYON_MERKEZI.md). The query goes to the API
 * with this browser's session, so only the person who started the round trip can finish it; a forwarded
 * consent link opened in another browser (another session, or none) connects nothing. The browser then goes
 * to one of the app's integration screens with the outcome; the address carrying the code is never a page.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const outcome = await complete(req);
  const res = NextResponse.redirect(new URL(`${outcome.returnPath}?meta=${outcome.result}`, req.url), { status: 303 });
  res.headers.set('cache-control', 'no-store');
  res.headers.set('referrer-policy', 'no-referrer');
  return res;
}

async function complete(req: NextRequest): Promise<OAuthCompleteDTO> {
  const params = req.nextUrl.searchParams;
  const parsed = CompleteMetaConnectSchema.safeParse(
    Object.fromEntries(
      (['state', 'code', 'error'] as const)
        .map((name) => [name, single(params, name)] as const)
        .filter(([, value]) => value !== undefined),
    ),
  );
  const access = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!parsed.success || !access) return FAILED;
  const upstream = await fetch(`${apiInternalBaseUrl()}/oauth/meta/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access}`, ...forwardedFor(req.headers) },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  }).catch(() => null);
  if (!upstream?.ok) return FAILED;
  const answer = (await upstream.json().catch(() => null)) as Partial<OAuthCompleteDTO> | null;
  // Only one of the app's own integration screens, whatever the answer says.
  const returnPath =
    typeof answer?.returnPath === 'string' && OAUTH_RETURN_PATH_PATTERN.test(answer.returnPath)
      ? answer.returnPath
      : '/panel';
  const result: OAuthResult = (OAUTH_RESULTS as readonly unknown[]).includes(answer?.result)
    ? (answer?.result as OAuthResult)
    : 'error';
  return { returnPath, result };
}
