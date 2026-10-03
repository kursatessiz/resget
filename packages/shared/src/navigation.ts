import type { PermissionKey } from './permissions';

/**
 * Restaurant panel navigation, one list for web and mobile. An item renders
 * only when the member holds its permission; the overview needs none. Labels
 * are the `nav.<key>` messages, paths are relative to /panel/<slug>.
 */
export interface PanelNavItem {
  key: string;
  path: string;
  permission: PermissionKey | null;
}

export const PANEL_NAV: readonly PanelNavItem[] = [
  { key: 'home', path: '', permission: null },
  { key: 'orders', path: '/siparisler', permission: 'orders.view' },
  { key: 'dispatch', path: '/sevk', permission: 'dispatch.view' },
  { key: 'menu', path: '/menu', permission: 'menu.view' },
  { key: 'tables', path: '/masalar', permission: 'tables.manage' },
  { key: 'customers', path: '/musteriler', permission: 'customers.view' },
  { key: 'finance', path: '/finans', permission: 'finance.view' },
  { key: 'payments', path: '/odeme', permission: 'payments.manage' },
  { key: 'courier', path: '/kurye', permission: 'courier.manage' },
  { key: 'campaigns', path: '/kampanyalar', permission: 'campaigns.view' },
  { key: 'reports', path: '/raporlar', permission: 'reports.view' },
  { key: 'subscription', path: '/plan', permission: 'subscription.manage' },
  { key: 'staff', path: '/personel', permission: 'staff.manage' },
  { key: 'settings', path: '/ayarlar', permission: 'restaurant.settings.view' },
];

export function visibleNav(permissions: ReadonlySet<PermissionKey> | readonly PermissionKey[]): PanelNavItem[] {
  const set = permissions instanceof Set ? permissions : new Set(permissions);
  return PANEL_NAV.filter((item) => item.permission === null || set.has(item.permission));
}
