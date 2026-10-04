import type { FeatureKey, MembershipSummaryDTO, PermissionKey } from '@resget/shared';

export type MobileTab = 'courier' | 'dispatch' | 'orders' | 'myOrders' | 'account';

/**
 * Tabs a person sees: staff tabs from their effective permissions in the
 * chosen restaurant, then their own orders as a customer (everyone is one)
 * and the account. One app, roles from the membership. Courier and
 * dispatch tabs need the own-courier module switched on for the restaurant
 * (docs/OZELLIK_ANAHTARLARI.md).
 */
export function tabsFor(
  permissions: readonly PermissionKey[] | ReadonlySet<PermissionKey>,
  features: readonly FeatureKey[] | ReadonlySet<FeatureKey>,
): MobileTab[] {
  const set = permissions instanceof Set ? permissions : new Set(permissions);
  const on = features instanceof Set ? features : new Set(features);
  const tabs: MobileTab[] = [];
  const dispatchOn = on.has('own_courier_dispatch');
  if (dispatchOn && set.has('courier.deliver')) tabs.push('courier');
  if (dispatchOn && set.has('dispatch.view')) tabs.push('dispatch');
  if (set.has('orders.view')) tabs.push('orders');
  tabs.push('myOrders', 'account');
  return tabs;
}

/** The membership the app opens with: the last chosen one when it is still active, else the first active one. */
export function pickMembership(
  memberships: readonly MembershipSummaryDTO[],
  lastRestaurantId: string | null,
): MembershipSummaryDTO | null {
  const active = memberships.filter((m) => m.status === 'ACTIVE');
  return active.find((m) => m.restaurantId === lastRestaurantId) ?? active[0] ?? null;
}
