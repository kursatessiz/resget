import { NextResponse } from 'next/server';
import { appleAppSiteAssociation } from '@/lib/app-links';

export const dynamic = 'force-dynamic';

/** iOS fetches this once per install; absent until the deployment names its App ID (docs/MOBIL.md). */
export function GET(): NextResponse {
  const body = appleAppSiteAssociation();
  if (!body) return new NextResponse(null, { status: 404 });
  return NextResponse.json(body, { headers: { 'cache-control': 'public, max-age=3600' } });
}
