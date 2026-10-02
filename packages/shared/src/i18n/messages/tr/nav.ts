/** Restaurant panel navigation. Menus render from the user's effective permissions. */
export const trNav = {
  'nav.home': 'Özet',
  'nav.orders': 'Siparişler',
  'nav.menu': 'Menü',
  'nav.tables': 'Masalar ve QR',
  'nav.customers': 'Müşteriler',
  'nav.finance': 'Finans',
  'nav.payouts': 'Hakedişler',
  'nav.campaigns': 'Kampanyalar',
  'nav.reports': 'Raporlar',
  'nav.courier': 'Kurye',
  'nav.settings': 'Ayarlar',
  'nav.subscription': 'Plan ve krediler',
  'nav.switchRestaurant': 'İşletme değiştir',
  'nav.signOut': 'Çıkış yap',
} as const satisfies Record<string, string>;
