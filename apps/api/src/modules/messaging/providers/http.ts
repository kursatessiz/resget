/** Small fetch wrapper shared by the provider adapters: one timeout, JSON or form bodies, parsed JSON answers. */
export interface HttpCall {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string>;
}

export interface HttpAnswer<T> {
  ok: boolean;
  status: number;
  body: T | null;
}

export const PROVIDER_TIMEOUT_MS = 10_000;

export function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}

/** Throws on network trouble (the engine logs PROVIDER_ERROR); a non-2xx answer is returned for the adapter to judge. */
export async function callProvider<T>(
  fetchImpl: typeof fetch,
  call: HttpCall,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<HttpAnswer<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { accept: 'application/json', ...(call.headers ?? {}) };
    let body: string | undefined;
    if (call.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(call.json);
    } else if (call.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(call.form).toString();
    }
    const response = await fetchImpl(call.url, {
      method: call.method ?? 'POST',
      headers,
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

/** Digits only, the form most gateways want (E.164 without the plus). */
export function digitsOf(e164: string): string {
  return e164.replace(/\D/g, '');
}
