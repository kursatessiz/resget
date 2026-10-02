import type { trQr } from '../tr/qr';

export const enQr: Record<keyof typeof trQr, string> = {
  'qr.page.title': '{restaurant} menu',
  'qr.page.table': 'Table {label}',
  'qr.page.orderToTable': 'Order to the table',
  'qr.page.orderDelivery': 'Order delivery next time',
  'qr.page.register': 'Sign up with your phone number and order in one tap',
  'qr.page.poweredBy': 'Powered by Resget',
  'qr.page.notFound': 'This QR code is not valid. Please ask the staff.',
  'qr.tables.title': 'Tables and QR codes',
  'qr.tables.add': 'Add table',
  'qr.tables.label': 'Table name',
  'qr.tables.download': 'Download QR label',
  'qr.tables.regenerate': 'Regenerate QR code',
  'qr.tables.regenerateWarning': 'Old labels stop working.',
  'qr.funnel.title': 'QR conversion',
  'qr.funnel.viewed': 'Viewed the menu',
  'qr.funnel.started': 'Started an order',
  'qr.funnel.placed': 'Placed an order',
  'qr.funnel.registered': 'Registered',
};
