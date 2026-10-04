# Restoran paneli: müşteriler, raporlar, kurye, kampanyalar ve sadakat

Panel menüsü (`PANEL_NAV`, `packages/shared/src/navigation.ts`) kullanıcının etkin izinlerinden çizilir; her bağlantının arkasında bir ekran vardır. Sipariş, sevk, menü, masa, ayar, ödeme, personel, plan ve finans ekranları kendi belgelerinde anlatılır (`docs/SIPARIS_VE_SEVK.md`, `docs/MASA_QR.md`, `docs/ODEME.md`, `docs/PERSONEL.md`, `docs/MESAJLASMA.md`, `docs/FATURALAMA.md`). Bu belge kalan dört ekranı tanımlar.

## Menü içe aktarma (`/panel/<slug>/menu`, izin `menu.manage`)

Gerçek restoran verisiyle başlarken menü elle tek tek girilmez: restoranın elindeki Excel veya Google E-Tablolar dosyası CSV olarak kaydedilip menü ekranındaki "Menüyü dosyadan içe aktar" kartından yüklenir.

- **Sütunlar**: `category`, `name`, `price` zorunlu; `description`, `vat_rate` (KDV yüzdesi), `available` (evet / hayır, 1 / 0) isteğe bağlı. Türkçe başlıklar da tanınır (`kategori`, `ürün adı`, `açıklama`, `fiyat`, `kdv`, `satışta`); büyük-küçük harf, boşluk ve aksan fark etmez. Ayraç virgül, noktalı virgül (Türkçe Excel) veya sekme olabilir, tırnaklı alanlar ve BOM desteklenir. Örnek dosya karttan indirilir (`menuImportTemplate()`).
- **Fiyat**: ana birimde yazılır (`120`, `120,50`, `1.250,50`, `1,250.50`); restoranın para biriminin ondalık basamağına göre tam sayı minör birime çevrilir, kayan noktalı hesap yapılmaz ve basamak fazlası satırı hatalı sayar.
- **KDV**: sütun yoksa restoranın ülkesinin yemek KDV'si kullanılır (`FOOD_VAT_BPS_BY_COUNTRY`; tanımsız ülkede sütun zorunludur). Sütun varsa satır bazında uygulanır.
- **Eşleştirme**: kategori ve ürün adı (büyük-küçük harf ve boşluklar yok sayılarak) mevcut kayıtlarla eşleşir. Olmayan kategori sona eklenir, olmayan ürün kategorisinin sonuna eklenir; mevcut üründe fiyat her zaman, açıklama / KDV / satışta durumu yalnızca dosyada o sütun varsa güncellenir. Böylece aynı dosya fiyat güncellemesi için tekrar yüklenebilir. Ürün silinmez.
- **Akış**: `POST /restaurants/:id/menu/import` (`{ csv, dryRun }`). Ön izleme (`dryRun: true`) hiçbir şey yazmaz; satır sayısı, yeni / güncellenecek / değişmeyecek ürün sayıları, yeni kategoriler ve her hatalı satır (satır numarası ve sebep) döner. Uygulama yalnızca hiç hata yoksa ve tek işlemde yapılır; hatalı dosya `MENU_IMPORT_INVALID` ile reddedilir. Bir dosyada en fazla 2000 ürün; JSON gövde sınırı bu yüzden 1 MB'dir.
- Seçenek grupları (modifier) ve görseller dosyayla gelmez, menü düzenleyiciden eklenir.

## Müşteriler (`/panel/<slug>/musteriler`, izin `customers.view`)

Masadan, restoranın kendi sipariş sayfasından veya pazaryerinden sipariş veren ya da masa QR'ından kaydolan herkes o restoranın `RestaurantCustomer` satırı olur (`docs/VERI_MODELI.md`). Liste restorana aittir; platform başka restoranla veya üçüncü tarafla paylaşmaz.

- `GET /restaurants/:id/customers?query&sort=recent|orders|spend&page&pageSize`: ad veya telefonla arama, son sipariş / sipariş sayısı / toplam harcamaya göre sıralama; özet (toplam, son 30 günde yeni, tekrar sipariş veren). `customers.contact.view` izni olmayan personel telefonu maskeli görür.
- `GET /restaurants/:id/customers/:customerId` ve `GET .../:customerId/orders` (`orders.view` de gerekir): müşteri kartı ve son 20 siparişi, sipariş ekranıyla aynı eşleme ve maskeleme.
- `PATCH /restaurants/:id/customers/:customerId` (`customers.manage` + Pro özelliği `crm`, `PLAN_FEATURE_REQUIRED`): etiketler (en çok 20) ve not (en çok 500 karakter). Pazarlama izni (`marketingOptIn`) müşterinin kendi onayıdır, personel değiştiremez.
- Sayaçlar (`orderCount`, `lifetimeGrossMinor`, `lastOrderAt`) sipariş yerleştirildiğinde artar; iptal edilen sipariş sayaçtan düşmez (rapor ekranı tamamlanan siparişi ayrı sayar).
- Her müşteride sadakat puanı (`loyaltyPoints`) görünür; `loyalty.manage` izni ve Pro planıyla kartta puan düzeltme yapılır (`docs/SADAKAT.md`).

## Raporlar (`/panel/<slug>/raporlar`, izin `reports.view`)

- `GET /restaurants/:id/reports/summary?days=7`: dönem UTC gün bazında bugün dahil geriye doğrudur. Tamamlanan sipariş (`DELIVERED`, `PICKED_UP`; `completedAt` ile), iptal ve ret (`placedAt` ile), ciro (müşteriden tahsil edilen), ortalama sepet, biriken komisyon (KDV dahil, `docs/FATURALAMA.md`), teslim şekli ve kanala göre dağılım, en çok satan 10 ürün (`OrderItem.nameSnapshot`), günlük seri. Her sayı sipariş anlık görüntülerinden gelir; geçmiş gün sonradan değişmez.
- Temel plan en çok 30 gün görür (`BASIC_REPORT_MAX_DAYS`); daha uzun dönem Pro özelliği `analytics` ister (`PLAN_FEATURE_REQUIRED`).
- `GET /restaurants/:id/reports/orders.csv?days` (`reports.view` + `analytics`): tamamlanan siparişler CSV olarak (tutarlar minör birim ve para birimi sütunu; formül karakteriyle başlayan hücreler etkisizleştirilir).

Raporlar ayrıca dönemin müşteri değerlendirmelerini gösterir: ortalama puan, sayı ve son yorumlar (`docs/VITRIN.md`, "Değerlendirme").

## Kurye (`/panel/<slug>/kurye`, izin `courier.manage`)

- `GET /restaurants/:id/courier/overview`: teslimat şekli ve ücret politikası (düzenleme Ayarlar sayfasında), bugünkü sefer / teslim / başarısız sayıları, kendi kuryeleri (`courier.deliver` izinli aktif üyelikler ve sahip; seferde mi), ülkede tanımlı kurye ağları ve seçili ağ, son 20 kurye talebi (`DeliveryRequest`: durum, teklif ve kesin ücret, sağlayıcı referansı).
- `PUT /restaurants/:id/courier/provider` (`courierProviderId` veya `null`): yalnızca restoranın ülkesindeki aktif ağlar seçilebilir (`COURIER_PROVIDER_NOT_FOUND`). Ağ, teslimat şekli `THIRD_PARTY_API` iken siparişte teklif verir (`docs/KURYE.md`); ücreti komisyondan ayrıdır.
- Teklif alma ucu değişmedi: `POST /restaurants/:id/courier/quote`.

## Kampanyalar (`/panel/<slug>/kampanyalar`, izin `campaigns.view`)

Pro özelliği `campaigns`: izinli müşterilere segment bazlı SMS / WhatsApp gönderimi, önizleme, zamanlama, vazgeçme bağlantısı ve sessiz saat kuralı `docs/KAMPANYALAR.md` içinde anlatılır. Temel planda ekran plan kuralını söyler ve Pro'ya geçişe bağlanır.

## Sadakat (`/panel/<slug>/sadakat`, izin `loyalty.view`)

Pro özelliği `loyalty`: tamamlanan siparişte puan, bir sonraki siparişte restoranın karşıladığı indirim. Kurallar, sayaçlar, son hareketler ve müşteri kartındaki düzeltme `docs/SADAKAT.md` içinde anlatılır. Temel planda kurallar salt okunurdur ve plan notu görünür.

## API erişimi (`/panel/<slug>/entegrasyon`, izin `integrations.manage`)

Pro özelliği `api_access`: restoranın kendi yazılımı için kapsamlı API anahtarları; nasıl kullanılır, oluşturma, tek seferlik token, iptal `docs/API_ERISIMI.md` içinde anlatılır.

## Sipariş kartında iade (`/panel/<slug>/siparisler`, izin `orders.refund`)

İptal edilmiş veya tamamlanmış, yakalanmış parası olan siparişin kartında "İade et" düğmesi çıkar; gerekçe girilmeden onay düğmesi açılmaz. Kart iade durumunu gösterir: işleniyor, yapılamadı (sebebiyle; düğme "İadeyi yeniden dene" olur) veya iade edilen tutar. Çevrim içi ödeme sağlayıcısına iade edilir, kapıda alınan para personelin elden iadesinden sonra onaylanır (`docs/ODEME.md` bölüm 3b).

## Değişmeyen kurallar

- Her uç `@RequirePermission` beyan eder; Pro özellikleri `@RequirePlanFeature` ile kapılanır ve `PLAN_FEATURE_REQUIRED` koduyla reddedilir.
- Telefon numaraları `customers.contact.view` olmadan maskelidir; dışa aktarma müşteri telefonunu içermez.
- Para tam sayı minör birim ve restoranın para birimidir; ekranlar `Intl` ile biçimlendirir.
