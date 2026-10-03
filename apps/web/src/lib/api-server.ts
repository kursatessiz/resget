import { cookies } from 'next/headers';
import type { MeDTO } from '@resget/shared';
import { apiInternalBaseUrl } from './server-env';
import { ACCESS_TOKEN_COOKIE } from './session';

/** Server-side call to the API with the signed-in member's access token. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`${apiInternalBaseUrl()}${path}`, { ...init, headers, cache: 'no-store' });
}

/** The signed-in user and their memberships, or null when there is no valid session. */
export async function getMe(): Promise<MeDTO | null> {
  const res = await apiFetch('/auth/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`auth/me failed with ${res.status}`);
  return (await res.json()) as MeDTO;
}
