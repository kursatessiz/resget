import type { trScheduling } from '../tr/scheduling';

export const enScheduling: Record<keyof typeof trScheduling, string> = {
  'scheduling.title': 'Scheduled orders',
  'scheduling.intro':
    'Customers can order now and pick a later time within your opening hours; you take pre-orders while closed too. Accept the order any time before its slot; the accept alarm follows when you have to start preparing.',
  'scheduling.enabled': 'Take scheduled orders',
  'scheduling.slotMinutes': 'Time slot length',
  'scheduling.minutes.one': '{count} minute',
  'scheduling.minutes.other': '{count} minutes',
  'scheduling.minLeadMinutes': 'Earliest (minutes ahead)',
  'scheduling.minLeadHelp': 'The first time on offer is at least this long after the order.',
  'scheduling.maxDaysAhead': 'Latest (days ahead)',
  'scheduling.deliveryLeadMinutes': 'Delivery margin (minutes)',
  'scheduling.deliveryLeadHelp':
    'For delivery the chosen time is the arrival; the order must be ready this much earlier.',
  'scheduling.save': 'Save',
  'scheduling.saved': 'Scheduled order settings saved.',
};
