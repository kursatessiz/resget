export const trAccounting = {
  'accounting.title': 'Muhasebe dökümü',
  'accounting.intro':
    'Bir ayın siparişlerini muhasebeciniz için CSV olarak indirin. Tutarlar her siparişin kayıtlı hakediş dökümüdür; panel, defter ve komisyon faturasıyla aynıdır. Ay, komisyon faturasıyla aynı şekilde UTC takvim ayıdır.',
  'accounting.month': 'Ay',
  'accounting.orders': 'Siparişler (CSV)',
  'accounting.lines': 'Sipariş kalemleri ve KDV oranları (CSV)',
  'accounting.note':
    'Ödemesi tamamlanmamış çevrim içi siparişler dosyada yer almaz. İptal ve iadeler durum ve iade sütunlarıyla listelenir.',
} as const satisfies Record<string, string>;
