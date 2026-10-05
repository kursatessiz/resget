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
  'features.page_engine.name': 'Sayfa motoru ve SEO',
  'features.page_engine.description':
    'Platform sitesinde bloklarla sayfa, açılan ilçeler için otomatik ilçe sayfaları, site haritası ve restoran sayfalarında yapılandırılmış veri.',
  'features.blog.name': 'Blog',
  'features.blog.description':
    'Platform sitesinde blog yazıları (/blog), yazı başına yapılandırılmış veri ve site haritası; sayfa motoru açık olmalıdır.',
  'features.referrals.name': 'Müşteri tavsiyesi',
  'features.referrals.description':
    'Müşterinin kişisel davet kodu, arkadaşa ilk siparişte indirim ve davet edene ödül kuponu; kuponlar modülü ve PRO plan gerekir.',
  'features.partner_referrals.name': 'Restoran tavsiyesi',
  'features.partner_referrals.description':
    'Restoranın davet bağlantısı; yeni restorana kayıtta, davet edene yeni restoranın siparişleri tamamlanınca PRO süresi. Ödüller konsoldan ayarlanır, komisyon değişmez.',
  'features.feedback.name': 'Geri bildirim ve NPS',
  'features.feedback.description':
    'Düşük puanlarda takip kaydı ve ekibe bildirim, puan veren herkese değerlendirme bağlantısı, takip sayfasında NPS sorusu ve özet; PRO analitik.',
  'features.public_reviews.name': 'Herkese açık yorumlar',
  'features.public_reviews.description':
    'Değerlendirmeler işletme sayfasında kısaltılmış adla görünür; işletme herkese açık yanıt verir, uygunsuz yorumu platforma bildirir.',
  'features.churn_signals.name': 'Müşteri kayıp riski',
  'features.churn_signals.description':
    'Her müşterinin kendi sipariş aralığına göre yeni, düzenli, dönmedi, riskte ve kayıp sınıfları; geri kazanılacak müşteri listesi ve segmentlerde kayıp riski alanı; PRO analitik.',
  'features.restaurant_health.name': 'Restoran sağlığı (konsol)',
  'features.restaurant_health.description':
    'Konsolda sipariş düşüşü, sessizlik, ilk siparişin gelmemesi, gecikmiş fatura, askıdaki listeleme ve kartsız biten deneme belirtileriyle restoran listesi. Genel anahtarla açılır.',
  'features.marketing_approvals.name': 'Gönderim onayı ve sınırları',
  'features.marketing_approvals.description':
    'Kampanya, isteyen kişiden başka bir yetkili onaylamadan gönderilmez; içerik değişirse onay düşer. Konsolun belirlediği kampanya başına ve 24 saatlik alıcı sınırları uygulanır. Önce platform kiracısı için.',
  'features.audit_viewer.name': 'Denetim kayıtları (konsol)',
  'features.audit_viewer.description':
    'Konsolda denetim kayıtlarını işletme, işlem ve tarih filtreleriyle okuma; platform gönderimleri için hızlı filtre. Genel anahtarla açılır.',
  'features.ai_studio.name': 'Yapay zeka stüdyosu',
  'features.ai_studio.description':
    'Kampanya metni ve menü açıklaması taslakları; yalnızca taslak, kişisel veri modele gitmez, mesaj kredilerinden ayrı aylık token bütçesi. PRO.',
  'features.integration_hub.name': 'Entegrasyon merkezi',
  'features.integration_hub.description':
    'Facebook sayfaları ve Instagram işletme hesaplarının Meta onay ekranıyla (OAuth) bağlanması; erişim anahtarları şifreli saklanır. Lead Ads ve sosyal yayın bu bağlantıları kullanır.',
  'features.lead_ads.name': 'Lead Ads aday aktarımı',
  'features.lead_ads.description':
    'Facebook ve Instagram reklam formlarından gelen adaylar imzalı Meta bildirimiyle alınır ve satış hattına kişi olarak eklenir; pazarlama izni verilmiş sayılmaz. Entegrasyon merkezi gerekir.',
  'features.social_publishing.name': 'Sosyal yayın',
  'features.social_publishing.description':
    'Bağlı Facebook sayfalarına ve Instagram işletme hesaplarına gönderi hazırlama, zamanlama ve yayımlama; her hesabın sonucu ayrı izlenir. Entegrasyon merkezi gerekir.',
  'features.scheduled_orders.name': 'İleri tarihli sipariş',
  'features.scheduled_orders.description':
    'Müşteri siparişini şimdi verip çalışma saatleri içinden daha sonraki bir saat seçer; işletme kapalıyken de ön sipariş alınır. Kabul alarmı hazırlığa başlama zamanına göre çalar.',
  'features.allergens.name': 'Alerjen ve beslenme etiketleri',
  'features.allergens.description':
    'Menü ürünlerinde yasal 14 alerjen ve vejetaryen, vegan, glutensiz gibi etiketler; sipariş sayfasında gösterim ve alerjene göre gizleme filtresi.',
  'features.menu_dayparts.name': 'Öğün saatleri',
  'features.menu_dayparts.description':
    'Menü bölümlerine servis saatleri (kahvaltı, öğle menüsü); bölüm yalnızca bu saatlerde, ileri tarihli siparişte seçilen saate göre sipariş edilebilir.',
  'features.delivery_pin.name': 'Teslimat kodu',
  'features.delivery_pin.description':
    'Teslimat siparişinde müşterinin takip sayfasında dört haneli bir kod görünür; işletmenin kendi kuryesi teslimatı bu kodla tamamlar. İşletme kodsuz onaylayabilir, kayıtta ayrı görünür.',
  'features.attribution.name': 'Ziyaret ölçümü ve atıf',
  'features.attribution.description':
    'Çerez izin bandı, UTM ve reklam tıklama kimlikleriyle ziyaret kaydı, masa QR bağlantısı, dönüşümler ve atıf raporu; platform sitesinde aday formu.',
  'features.ordering_links.name': 'Sipariş bağlantıları',
  'features.ordering_links.description':
    'Instagram, Facebook, WhatsApp, Google ve TikTok için ayrı sipariş bağlantıları; her kanaldan gelen sipariş ve ciro, sipariş kartında kanal adı. Çerezsiz, siparişin kendisiyle ölçülür.',
  'features.kitchen_display.name': 'Mutfak ekranı',
  'features.kitchen_display.description':
    'Kabul edilen siparişler mutfak tabletinde fiş olarak, söz verilen saate göre sıralı; satır satır hazır işaretleme, menü bölümüne göre istasyon (ızgara, bar) ekranları, gecikme uyarısı.',
  'features.menu_stock.name': 'Menü stok takibi',
  'features.menu_stock.description':
    'Ürün başına porsiyon sayısı: siparişte düşer, sıfırda ürün satışta değil görünür, iptal ve retle geri gelir; sipariş sayfasında son porsiyonlar uyarısı.',
  'features.accounting_export.name': 'Muhasebe dökümü',
  'features.accounting_export.description':
    'Bir ayın siparişleri ve kalemleri muhasebeci için CSV olarak: kayıtlı hakediş dökümü, KDV oranları, iadeler, komisyon ve kesintiler.',
  'features.group_orders.name': 'Grup siparişi',
  'features.group_orders.description':
    'Restoran sayfasında paylaşılan tek sepet: bağlantıyla katılan herkes kendi seçimini ekler, sepet sahibi tek sipariş verir ve öder.',
  'features.table_tabs.name': 'Açık hesap',
  'features.table_tabs.description':
    'Masadaki siparişlerin açık hesaba yazılması; hesabın eşit, ürüne göre veya tutara göre bölünüp masada veya kasada ödenmesi.',
} as const satisfies Record<string, string>;
