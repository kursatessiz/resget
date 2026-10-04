/** Module switches (docs/OZELLIK_ANAHTARLARI.md): the name and one-line description of each module. */
export const trFeatures = {
  'features.marketplace.name': 'Pazaryeri',
  'features.marketplace.description': 'İşletmenin ilçe pazaryerinde listelenmesi.',
  'features.table_qr.name': 'Masa QR',
  'features.table_qr.description': 'Masadaki QR koddan menü ve sipariş; masa yönetimi ekranı.',
  'features.ratings.name': 'Sipariş değerlendirmesi',
  'features.ratings.description': 'Müşterinin tamamlanan siparişi takip sayfasından puanlaması.',
  'features.missing_item_claims.name': 'Eksik ürün bildirimi',
  'features.missing_item_claims.description': 'Müşterinin eksik ürünü bildirmesi ve işletme onayıyla kısmi iade.',
  'features.online_payment.name': 'Çevrim içi kart ödemesi',
  'features.online_payment.description':
    'Siparişte kartla çevrim içi ödeme (işletmenin POS bağlantısı veya platform PSP).',
  'features.meal_cards.name': 'Yemek kartları',
  'features.meal_cards.description': 'Yemek kartıyla çevrim içi ve kapıda ödeme; yemek kartı bağlantıları ekranı.',
  'features.partial_refunds.name': 'Kısmi iade',
  'features.partial_refunds.description': 'Tamamlanmış siparişte seçilen ürünlerin veya bir tutarın iadesi.',
  'features.own_courier_dispatch.name': 'Kendi kurye sevki',
  'features.own_courier_dispatch.description': 'Sevk panosu, sefer oluşturma ve kurye uygulamasındaki seferler.',
  'features.courier_network.name': 'Kurye ağı',
  'features.courier_network.description': 'Üçüncü taraf kurye ağından teklif alma ve ağ seçimi.',
  'features.crm.name': 'Müşteri notları ve etiketleri',
  'features.crm.description': 'Müşteri kartında not ve etiket (PRO).',
  'features.campaigns.name': 'Kampanyalar',
  'features.campaigns.description': 'İzinli müşterilere SMS ve WhatsApp kampanyaları (PRO).',
  'features.loyalty.name': 'Sadakat programı',
  'features.loyalty.description': 'Siparişte puan kazanma ve harcama (PRO).',
  'features.whatsapp_channel.name': 'WhatsApp kanalı',
  'features.whatsapp_channel.description': 'Mesajların WhatsApp ile gitmesi; kapalıyken SMS gider.',
  'features.custom_domain.name': 'Kendi alan adı',
  'features.custom_domain.description': 'Sipariş sayfasının işletmenin alan adında açılması (PRO).',
  'features.api_access.name': 'API erişimi ve webhook',
  'features.api_access.description': 'API anahtarları ve giden webhooklar; kapalıyken anahtarlar çalışmaz (PRO).',
  'features.order_availability.name': 'Sipariş alma durumu',
  'features.order_availability.description':
    'Siparişleri duraklatma, yoğun mod ve çalışma saatleri dışında sipariş kabul etmeme.',
  'features.delivery_zones.name': 'Teslimat bölgesi',
  'features.delivery_zones.description': 'Teslimat yarıçapı, en az sepet tutarı ve mesafeye göre teslimat ücreti.',
  'features.coupons.name': 'Kuponlar',
  'features.coupons.description':
    'İşletmenin karşıladığı indirim kodları: yüzde veya tutar, ilk sipariş, kullanım sınırları.',
  'features.claim_escalation.name': 'Bildirim yükseltme',
  'features.claim_escalation.description':
    '24 saatte karara bağlanmayan eksik ürün bildirimi platform konsoluna düşer; tekrar eden bildirim uyarısı.',
  'features.app_order_handling.name': 'Uygulamadan sipariş yönetimi',
  'features.app_order_handling.description':
    'Tablet ve telefonda siparişi kabul, ret, hazır ve teslim adımları; yeni siparişte titreşim ve bildirim.',
  'features.pos_integration.name': 'POS entegrasyonu',
  'features.pos_integration.description':
    "Yeni sipariş işletmenin kendi POS sistemine gider; otomatik kabul ve POS'tan durum bildirimi.",
  'features.marketing_platform.name': 'Platform pazarlaması',
  'features.marketing_platform.description':
    'Platformun kendi pazarlaması için platform kiracısı, pazarlama kullanıcıları ve Pazarlama alanı.',
  'features.contacts_crm.name': 'CRM ve satış hattı',
  'features.contacts_crm.description': 'Kişiler, aşamalı satış hattı, görüşme geçmişi, görevler ve CSV dışa aktarma.',
  'features.consent_v2.name': 'Rıza v2: kanal başına izin',
  'features.consent_v2.description':
    'Sipariş sırasında kanal başına izin kutuları, izin geçmişi ve dayanağı, AB için çift onay, tacir muafiyeti, gönderim sınırları ve İYS kaydı.',
  'features.email_channel.name': 'E-posta kanalı',
  'features.email_channel.description':
    'Kendi alan adından e-posta (SPF, DKIM, DMARC denetimi), geri dönen ve şikayet eden adreslerin bastırılması, deneme gönderimi.',
  'features.segments_v2.name': 'Segmentler v2',
  'features.segments_v2.description':
    'VE / VEYA kural diliyle kayıtlı segmentler, dinamik ve statik segment, kanal başına ulaşılabilirlik önizlemesi, kampanyada hedef segment.',
  'features.campaigns_v2.name': 'Kampanyalar v2',
  'features.campaigns_v2.description':
    'E-posta kampanyası, A/B testi, alıcı başına en iyi gönderim saati, dönüşüm ve atfedilen ciro.',
  'features.journeys.name': 'Otomatik akışlar',
  'features.journeys.description':
    'Sipariş sonrası teşekkür, ilk sipariş, değerlendirme isteği ve geri kazanım mesajları; izin, saat ve kredi kurallarıyla.',
  'features.kpi_dashboard.name': 'Huniler ve KPI panosu',
  'features.kpi_dashboard.description':
    'Pazarlama alanında restoran başına günlük sipariş, masa QR ve restoran hunileri, kanallar, ciro ve ilçe kırılımı.',
  'features.ad_integrations.name': 'Reklam entegrasyonları',
  'features.ad_integrations.description':
    'Meta, Google Ads ve TikTok hesabı bağlama, sunucudan dönüşüm gönderimi (yalnızca reklam izniyle), günlük harcama ve reklam getirisi raporu.',
  'features.attribution.name': 'Ziyaret ölçümü ve atıf',
  'features.attribution.description':
    'Çerez izin bandı, UTM ve reklam tıklama kimlikleriyle ziyaret kaydı, masa QR bağlantısı, dönüşümler ve atıf raporu; platform sitesinde aday formu.',
} as const satisfies Record<string, string>;
