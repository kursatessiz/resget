import type { trReports } from '../tr/reports';

export const enReports: Record<keyof typeof trReports, string> = {
  'reports.title': 'Reports',
  'reports.intro': 'Computed from the snapshots of completed orders; past days never change afterwards.',
  'reports.range': 'Range',
  'reports.range.days': 'Last {days} days',
  'reports.proRange': 'Longer ranges and the export are part of the Pro plan.',
  'reports.kpi.completed': 'Completed orders',
  'reports.kpi.cancelled': 'Cancelled and rejected',
  'reports.kpi.gross': 'Revenue',
  'reports.kpi.average': 'Average basket',
  'reports.kpi.commission': 'Commission accrued (VAT included)',
  'reports.byFulfillment': 'By fulfillment',
  'reports.byChannel': 'By channel',
  'reports.topItems': 'Best sellers',
  'reports.daily': 'Daily',
  'reports.orders': '{count} orders',
  'reports.quantity': '{count} sold',
  'reports.empty': 'No completed orders in this range.',
  'reports.export': 'Download CSV',
};
