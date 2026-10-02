import type { trMenu } from '../tr/menu';

export const enMenu: Record<keyof typeof trMenu, string> = {
  'menu.title': 'Menu',
  'menu.category': 'Category',
  'menu.item': 'Item',
  'menu.price': 'Price',
  'menu.vatRate': 'VAT rate',
  'menu.available': 'Available',
  'menu.unavailable': 'Sold out',
  'menu.modifiers': 'Options',
  'menu.addToOrder': 'Add to order',
  'menu.emptyCategory': 'No items in this category.',
};
