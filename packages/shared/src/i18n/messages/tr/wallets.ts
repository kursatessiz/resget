/** Platform wallets (docs/CUZDAN.md): the account page and the payment step of the ordering page. */
export const trWallets = {
  'wallets.title': 'Cüzdanlarım',
  'wallets.intro':
    'Masterpass veya bex hesabınızı bir kez bağlayın; platform üzerinden ödeme alan restoranlarda kayıtlı kartınızla ödeyin. Kart numaranız bizde saklanmaz.',
  'wallets.link': '{wallet} bağla',
  'wallets.linked': 'Kartlarınız eklendi.',
  'wallets.empty': 'Henüz bağlı cüzdan kartınız yok.',
  'wallets.card': '{wallet}: {brand} •••• {last4}',
  'wallets.expires': 'Son kullanma {month}/{year}',
  'wallets.remove': 'Kaldır',
  'wallets.removed': 'Kart kaldırıldı.',
  'wallets.payWith': '{wallet} ile öde: {brand} •••• {last4}',
} as const satisfies Record<string, string>;
