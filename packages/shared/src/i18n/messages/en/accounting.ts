import type { trAccounting } from '../tr/accounting';

export const enAccounting: Record<keyof typeof trAccounting, string> = {
  'accounting.title': 'Accounting export',
  'accounting.intro':
    "Download a month of orders as CSV for your accountant. The amounts are each order's recorded settlement; they match the panel, the ledger and the commission invoice. Like the commission invoice, the month is the UTC calendar month.",
  'accounting.month': 'Month',
  'accounting.orders': 'Orders (CSV)',
  'accounting.lines': 'Order lines and VAT rates (CSV)',
  'accounting.note':
    'Online orders whose payment never completed are not in the file. Cancellations and refunds are listed with their status and refund columns.',
};
