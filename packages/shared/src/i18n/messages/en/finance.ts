import type { trFinance } from '../tr/finance';

export const enFinance: Record<keyof typeof trFinance, string> = {
  'finance.ledger.title': 'Ledger and payouts',
  'finance.ledger.intro':
    'When the platform collects the money, every completed order writes its statement to the ledger; the weekly payable goes to your account in one payout within the legal window.',
  'finance.ledger.ownPos':
    'Your own POS collects, so the platform pays no payout; the commission comes with the monthly invoice.',
  'finance.ledger.pending': 'Pending payable: {amount}',
  'finance.ledger.pendingHelp': 'Lines not yet rolled into a weekly payout.',
  'finance.payouts.title': 'Payouts',
  'finance.payouts.empty': 'No payouts yet.',
  'finance.payouts.period': '{start} to {end}',
  'finance.payouts.scheduledFor': 'Scheduled: {date}',
  'finance.payouts.sentAt': 'Sent: {date}',
  'finance.payouts.settledAt': 'Settled: {date}',
  'finance.payouts.failed': 'Failed: {reason}',
  'finance.payouts.entries': '{count} lines',
  'finance.payouts.status.SCHEDULED': 'Scheduled',
  'finance.payouts.status.SENT': 'Sent',
  'finance.payouts.status.SETTLED': 'Settled',
  'finance.payouts.status.FAILED': 'Failed',
  'finance.entries.title': 'Ledger lines',
  'finance.entries.empty': 'No ledger lines yet.',
  'finance.entries.order': 'Order {code}',
};
