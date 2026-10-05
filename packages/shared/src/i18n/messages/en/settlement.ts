import type { trSettlement } from '../tr/settlement';

export const enSettlement: Record<keyof typeof trSettlement, string> = {
  'settlement.title': 'Settlement statement',
  'settlement.line.GROSS_SALE': 'Sale amount',
  'settlement.line.DISCOUNT': 'Discount',
  'settlement.line.DELIVERY_FEE': 'Delivery fee',
  'settlement.line.COURIER_COST': 'Courier cost',
  'settlement.line.PLATFORM_COMMISSION': 'Platform commission',
  'settlement.line.COMMISSION_VAT': 'VAT on commission',
  'settlement.line.PSP_FEE': 'Payment provider fee',
  'settlement.line.WITHHOLDING_TAX': 'E-commerce withholding tax',
  'settlement.line.REFUND': 'Refund',
  'settlement.line.CHARGEBACK': 'Chargeback',
  'settlement.line.COMMISSION_REVERSAL': 'Commission returned',
  'settlement.line.COMMISSION_VAT_REVERSAL': 'Commission VAT returned',
  'settlement.line.ADJUSTMENT': 'Adjustment',
  'settlement.line.RESTAURANT_PAYABLE': 'Payable to you',
  'settlement.line.PAYOUT_FEE': 'Faster payout fee',
  'settlement.withholdingNote':
    'The withholding is forwarded to the tax office in your name; you can offset it in your tax return.',
  'settlement.pspNote': 'The payment provider fee is the documented real rate; no margin is added.',
  'settlement.payout.scheduled': 'The payout will be sent to your account on {date}.',
};
