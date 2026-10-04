import { redirect } from 'next/navigation';
import type { PlatformContextDTO } from '@resget/shared';
import { apiFetch } from './api-server';

export type PlatformAccess = { kind: 'ok'; context: PlatformContextDTO } | { kind: 'notSetUp' | 'disabled' | 'denied' };

/** Who the signed-in person is on the platform tenant (docs/PAZARLAMA.md); sends a visitor without a session to sign in. */
export async function platformAccess(): Promise<PlatformAccess> {
  const res = await apiFetch('/platform/context');
  if (res.status === 401) redirect('/giris?next=/pazarlama');
  if (res.ok) return { kind: 'ok', context: (await res.json()) as PlatformContextDTO };
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  if (body.code === 'PLATFORM_NOT_SET_UP') return { kind: 'notSetUp' };
  if (body.code === 'FEATURE_DISABLED') return { kind: 'disabled' };
  return { kind: 'denied' };
}
