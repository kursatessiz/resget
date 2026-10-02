/** Restaurant statement lines (docs/MUTABAKAT.md). */
export const trSettlement = {
  'settlement.title': 'Hakediş dökümü',
  'settlement.line.GROSS_SALE': 'Satış tutarı',
  'settlement.line.DISCOUNT': 'İndirim',
  'settlement.line.DELIVERY_FEE': 'Teslimat ücreti',
  'settlement.line.COURIER_COST': 'Kurye maliyeti',
  'settlement.line.PLATFORM_COMMISSION': 'Platform komisyonu',
  'settlement.line.COMMISSION_VAT': 'Komisyon KDV',
  'settlement.line.PSP_FEE': 'Ödeme kuruluşu kesintisi',
  'settlement.line.WITHHOLDING_TAX': 'E-ticaret tevkifatı',
  'settlement.line.REFUND': 'İade',
  'settlement.line.ADJUSTMENT': 'Düzeltme',
  'settlement.line.RESTAURANT_PAYABLE': 'Hakediş',
  'settlement.withholdingNote': 'Tevkifat adınıza vergi dairesine aktarılır; vergi beyanınızda mahsup edebilirsiniz.',
  'settlement.pspNote': 'Ödeme kuruluşu kesintisi belgelenen gerçek orandır; üzerine marj eklenmez.',
  'settlement.payout.scheduled': 'Ödeme {date} tarihinde hesabınıza gönderilecek.',
} as const satisfies Record<string, string>;
