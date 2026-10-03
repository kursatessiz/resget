import { notFound, redirect } from 'next/navigation';
import type { MeDTO, MembershipSummaryDTO, PermissionKey } from '@resget/shared';
import { getMe } from './api-server';

/**
 * Resolves the signed-in member of the restaurant behind a panel slug and
 * checks the permission the screen needs. The middleware already ensured a
 * session; a missing membership or permission is a 404, never a hint that
 * the restaurant exists.
 */
/** The platform owner's console: anyone else gets a 404, never a hint that it exists. */
export async function requireSuperAdmin(): Promise<MeDTO> {
  const me = await getMe();
  if (!me) redirect('/giris?next=/admin');
  if (!me.user.isSuperAdmin) notFound();
  return me;
}

export async function requireMembership(
  slug: string,
  permission: PermissionKey | null,
): Promise<{ me: MeDTO; membership: MembershipSummaryDTO; can: (key: PermissionKey) => boolean }> {
  const me = await getMe();
  if (!me) redirect(`/giris?next=/panel/${slug}`);
  const membership = me.memberships.find((m) => m.restaurantSlug === slug);
  if (!membership) notFound();
  const can = (key: PermissionKey) => membership.permissions.includes(key);
  if (permission && !can(permission)) notFound();
  return { me, membership, can };
}
