import { getServerEnv } from '@/lib/server-env';

export const dynamic = 'force-dynamic';

/** The IndexNow key file (docs/SEO.md): search engines fetch it to confirm a ping came from this site. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const key = getServerEnv().INDEXNOW_KEY;
  if (!key || file !== `${key}.txt`) return new Response('Not found', { status: 404 });
  return new Response(key, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
