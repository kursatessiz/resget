import type { trDayparts } from '../tr/dayparts';

export const enDayparts: Record<keyof typeof trDayparts, string> = {
  'dayparts.servedOnly': 'This section can be ordered today only at: {hours}.',
  'dayparts.notToday': 'This section cannot be ordered today.',
  'dayparts.notAtThisTime': 'This item is not served at the chosen time; remove it or pick another time.',
  'dayparts.manage.title': 'Serving hours',
  'dayparts.manage.always': 'Whenever the restaurant is open',
  'dayparts.manage.window': 'Only at set times',
  'dayparts.manage.days': 'Days',
  'dayparts.manage.from': 'From',
  'dayparts.manage.to': 'To',
  'dayparts.manage.help':
    'Sections such as breakfast or lunch can be ordered only in these hours; for a window past midnight, enter an end earlier than the start.',
  'dayparts.manage.summary': 'Served: {hours}',
  'dayparts.manage.invalid': 'The end cannot equal the start and at least one day must be chosen.',
  'dayparts.day.mon': 'Mon',
  'dayparts.day.tue': 'Tue',
  'dayparts.day.wed': 'Wed',
  'dayparts.day.thu': 'Thu',
  'dayparts.day.fri': 'Fri',
  'dayparts.day.sat': 'Sat',
  'dayparts.day.sun': 'Sun',
};
