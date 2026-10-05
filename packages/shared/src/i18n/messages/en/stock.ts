import type { trStock } from '../tr/stock';

export const enStock: Record<keyof typeof trStock, string> = {
  'stock.manage.field': 'Stock (portions)',
  'stock.manage.help': 'Leave empty to stop counting. At zero the item shows as not available on the ordering page.',
  'stock.manage.invalid': 'Stock must be zero or a positive whole number.',
  'stock.manage.left.one': 'Stock: {count}',
  'stock.manage.left.other': 'Stock: {count}',
  'stock.manage.soldOut': 'Sold out',
  'stock.shop.left.one': 'Last {count} portion',
  'stock.shop.left.other': 'Last {count} portions',
};
