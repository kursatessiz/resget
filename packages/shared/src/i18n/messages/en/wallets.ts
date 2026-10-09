import type { trWallets } from '../tr/wallets';

/** Platform wallets (docs/CUZDAN.md): the account page and the payment step of the ordering page. */
export const enWallets: Record<keyof typeof trWallets, string> = {
  'wallets.title': 'My wallets',
  'wallets.intro':
    'Link your Masterpass or bex account once and pay with your saved card at restaurants that take payment through the platform. We never store your card number.',
  'wallets.link': 'Link {wallet}',
  'wallets.linked': 'Your cards were added.',
  'wallets.empty': 'You have no linked wallet cards yet.',
  'wallets.card': '{wallet}: {brand} •••• {last4}',
  'wallets.expires': 'Expires {month}/{year}',
  'wallets.remove': 'Remove',
  'wallets.removed': 'The card was removed.',
  'wallets.payWith': 'Pay with {wallet}: {brand} •••• {last4}',
  'wallets.app.returnTitle': 'Go back to the app',
  'wallets.app.returnBody': 'Wallet linking finishes in the app. Open the app to continue.',
  'wallets.app.open': 'Open the app',
  'wallets.app.linking': 'Adding your cards.',
  'wallets.app.removeConfirm': 'Remove this card?',
  'wallets.app.back': 'Back to my orders',
} as const satisfies Record<string, string>;
