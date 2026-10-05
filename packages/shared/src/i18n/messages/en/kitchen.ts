import type { trKitchen } from '../tr/kitchen';

export const enKitchen: Record<keyof typeof trKitchen, string> = {
  'kitchen.title': 'Kitchen display',
  'kitchen.intro':
    'Accepted orders, sorted by the promised ready time. Marking a line done moves the order to preparing; when every line is done, press Ready.',
  'kitchen.station.label': 'Station',
  'kitchen.station.all': 'All stations',
  'kitchen.empty': 'No orders waiting in the kitchen.',
  'kitchen.live': 'Live',
  'kitchen.reconnecting': 'Reconnecting...',
  'kitchen.ticket.title': 'Order {code}',
  'kitchen.ticket.table': 'Table {table}',
  'kitchen.ticket.due': 'Ready by {time}',
  'kitchen.ticket.late': 'Late',
  'kitchen.ticket.scheduled': 'Scheduled: {time}',
  'kitchen.ticket.note': 'Note: {note}',
  'kitchen.ticket.progress': '{done} / {total} done',
  'kitchen.item.quantity': '{quantity} x {name}',
  'kitchen.item.mark': 'Mark done',
  'kitchen.item.unmark': 'Undo',
  'kitchen.action.ready': 'Ready',
  'kitchen.station.manage': 'Kitchen station',
  'kitchen.station.name': 'Station name',
  'kitchen.station.help':
    "This section's items show at this station on the kitchen display (for example Grill, Cold kitchen, Bar). Left empty, they show only on the all stations view.",
  'kitchen.station.clear': 'Remove station',
  'kitchen.station.badge': 'Station: {station}',
};
