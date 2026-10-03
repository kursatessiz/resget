import type { trPanel } from '../tr/panel';

export const enPanel: Record<keyof typeof trPanel, string> = {
  'panel.title': 'Restaurant panel',
  'panel.role': 'Your role: {role}',
  'panel.plan.BASIC': 'Basic plan',
  'panel.plan.PRO': 'Pro plan',
  'panel.overview.title': 'Overview',
  'panel.overview.welcome': 'Welcome, {name}.',
  'panel.overview.hint': 'Use the menu on the left for orders, the dispatch board and settings.',
  'panel.overview.openOrders': 'Open orders',
  'panel.overview.openDispatch': 'Open the dispatch board',
  'panel.comingSoon': 'This screen is being prepared.',
  'panel.restaurants': 'Your restaurants',
  'panel.overview.openMenu': 'Manage the menu',
  'panel.overview.openTables': 'Tables and QR',
  'panel.overview.openPayments': 'Payment settings',
  'panel.overview.openSettings': 'Settings',
};
