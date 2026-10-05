import type { trSocial } from '../tr/social';

export const enSocial: Record<keyof typeof trSocial, string> = {
  'social.title': 'Social accounts',
  'social.intro':
    "Connect your Facebook pages and the Instagram business accounts linked to them through Meta's consent screen. Access keys are stored encrypted and never shown; you can remove a connection at any time.",
  'social.connect': 'Connect with Meta',
  'social.reconnect': 'Reconnect or add accounts',
  'social.empty': 'No accounts connected yet.',
  'social.kind.FACEBOOK_PAGE': 'Facebook page',
  'social.kind.INSTAGRAM_BUSINESS': 'Instagram business account',
  'social.status.ACTIVE': 'Active',
  'social.status.EXPIRED': 'Needs reconnecting',
  'social.enabled': 'Use it',
  'social.disconnect': 'Disconnect',
  'social.connectedAt': 'Connected: {date}',
  'social.result.connected': 'Your Meta accounts are connected. Choose which ones to use.',
  'social.result.denied': "Permission was not given on Meta's consent screen; no account was connected.",
  'social.result.error': 'The connection could not be completed; try again.',
} as const;
