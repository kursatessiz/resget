export const trStock = {
  'stock.manage.field': 'Stok (porsiyon)',
  'stock.manage.help': 'Boş bırakırsanız sayılmaz. Sıfıra inince ürün sipariş sayfasında satışta değil görünür.',
  'stock.manage.invalid': 'Stok sıfır veya pozitif bir tam sayı olmalı.',
  'stock.manage.left.one': 'Stok: {count}',
  'stock.manage.left.other': 'Stok: {count}',
  'stock.manage.soldOut': 'Tükendi',
  'stock.shop.left.one': 'Son {count} porsiyon',
  'stock.shop.left.other': 'Son {count} porsiyon',
} as const satisfies Record<string, string>;
