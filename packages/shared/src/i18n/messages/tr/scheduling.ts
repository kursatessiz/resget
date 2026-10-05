export const trScheduling = {
  'scheduling.title': 'İleri tarihli sipariş',
  'scheduling.intro':
    'Müşteriler siparişini şimdi verip çalışma saatleriniz içinden daha sonraki bir saat seçebilir; kapalıyken de ön sipariş alırsınız. Siparişi saatinden önce istediğiniz zaman kabul edebilirsiniz; kabul alarmı hazırlığa başlamanız gereken zamana göre çalar.',
  'scheduling.enabled': 'İleri tarihli sipariş al',
  'scheduling.slotMinutes': 'Saat aralığı',
  'scheduling.minutes.one': '{count} dakika',
  'scheduling.minutes.other': '{count} dakika',
  'scheduling.minLeadMinutes': 'En erken (dakika sonra)',
  'scheduling.minLeadHelp': 'İlk seçilebilir saat, siparişten en az bu kadar sonradır.',
  'scheduling.maxDaysAhead': 'En geç (gün sonra)',
  'scheduling.deliveryLeadMinutes': 'Teslimat payı (dakika)',
  'scheduling.deliveryLeadHelp': 'Teslimatta seçilen saat varış saatidir; sipariş bu kadar önce hazır olmalıdır.',
  'scheduling.save': 'Kaydet',
  'scheduling.saved': 'İleri tarihli sipariş ayarları kaydedildi.',
} as const satisfies Record<string, string>;
