import { headers } from 'next/headers';
import { consentRegimeFor, visitorCountry } from '@resget/shared';
import type { ConsentRegime } from '@resget/shared';

/** The banner regime for this request: edge country header first, then the browser's language region (docs/ATIF.md). */
export async function consentRegime(): Promise<ConsentRegime> {
  const h = await headers();
  const country = visitorCountry(h.get('cf-ipcountry') ?? h.get('x-country-code'), h.get('accept-language'));
  return consentRegimeFor(country);
}
