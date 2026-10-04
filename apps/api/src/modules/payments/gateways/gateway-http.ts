/** Fetch helpers for the gateway adapters: one timeout, JSON or form bodies, tolerant JSON parsing. */
export const GATEWAY_TIMEOUT_MS = 15_000;

export interface GatewayAnswer<T> {
  ok: boolean;
  status: number;
  body: T | null;
}

export async function postJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number = GATEWAY_TIMEOUT_MS,
): Promise<GatewayAnswer<T>> {
  return request(fetchImpl, url, { ...headers, 'content-type': 'application/json' }, body, timeoutMs);
}

export async function postForm<T>(
  fetchImpl: typeof fetch,
  url: string,
  fields: Record<string, string>,
  timeoutMs: number = GATEWAY_TIMEOUT_MS,
): Promise<GatewayAnswer<T>> {
  const body = new URLSearchParams(fields).toString();
  return request(fetchImpl, url, { 'content-type': 'application/x-www-form-urlencoded' }, body, timeoutMs);
}

async function request<T>(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<GatewayAnswer<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { accept: 'application/json', ...headers },
      body,
      signal: controller.signal,
    });
    let parsed: T | null = null;
    try {
      parsed = (await response.json()) as T;
    } catch {
      parsed = null;
    }
    return { ok: response.ok, status: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/** Decimal string with two places from integer minor units (both supported currencies of these gateways use two). */
export function majorString(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

/** Integer minor units from a provider's decimal amount, tolerant of strings and numbers. */
export function minorOf(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

/** Query-string or form-encoded body into a plain object. */
export function parseForm(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) out[key] = value;
  return out;
}
