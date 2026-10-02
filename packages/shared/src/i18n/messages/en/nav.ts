import type { trNav } from '../tr/nav';

export const enNav: Record<keyof typeof trNav, string> = {
  'nav.home': 'Overview',
  'nav.orders': 'Orders',
  'nav.menu': 'Menu',
  'nav.tables': 'Tables and QR',
  'nav.customers': 'Customers',
  'nav.finance': 'Finance',
  'nav.payouts': 'Payouts',
  'nav.campaigns': 'Campaigns',
  'nav.reports': 'Reports',
  'nav.courier': 'Courier',
  'nav.settings': 'Settings',
  'nav.subscription': 'Plan and credits',
  'nav.switchRestaurant': 'Switch restaurant',
  'nav.signOut': 'Sign out',
};
