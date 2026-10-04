import { NextResponse } from 'next/server';
import { androidAssetLinks } from '@/lib/app-links';

export const dynamic = 'force-dynamic';

/** Android verifies the app's signing certificate against this file (docs/MOBIL.md). */
export function GET(): NextResponse {
  const body = androidAssetLinks();
  if (!body) return new NextResponse(null, { status: 404 });
  return NextResponse.json(body, { headers: { 'cache-control': 'public, max-age=3600' } });
}
