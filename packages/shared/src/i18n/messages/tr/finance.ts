/** Ledger and payouts in the restaurant panel (/panel/<slug>/finans) and the console. */
export const trFinance = {
  'finance.ledger.title': 'Defter ve hakedişler',
  'finance.ledger.intro':
    'Platform tahsilatı yaptığında her tamamlanan siparişin dökümü deftere yazılır; haftanın hakedişi tek ödemede yasal sürede hesabınıza gönderilir.',
  'finance.ledger.ownPos':
    'Tahsilatı kendi POS cihazınız yaptığı için platform size hakediş ödemez; komisyon ay sonu faturasıyla gelir.',
  'finance.ledger.pending': 'Bekleyen hakediş: {amount}',
  'finance.ledger.pendingHelp': 'Haftalık ödemeye henüz girmemiş satırların toplamı.',
  'finance.payouts.title': 'Hakediş ödemeleri',
  'finance.payouts.empty': 'Henüz hakediş ödemesi yok.',
  'finance.payouts.period': '{start} ile {end} arası',
  'finance.payouts.scheduledFor': 'Planlanan: {date}',
  'finance.payouts.sentAt': 'Gönderildi: {date}',
  'finance.payouts.settledAt': 'Hesapta: {date}',
  'finance.payouts.failed': 'Başarısız: {reason}',
  'finance.payouts.entries': '{count} satır',
  'finance.payouts.status.SCHEDULED': 'Planlandı',
  'finance.payouts.status.SENT': 'Gönderildi',
  'finance.payouts.status.SETTLED': 'Hesapta',
  'finance.payouts.status.FAILED': 'Başarısız',
  'finance.entries.title': 'Defter satırları',
  'finance.entries.empty': 'Henüz defter satırı yok.',
  'finance.entries.order': 'Sipariş {code}',
} as const satisfies Record<string, string>;
