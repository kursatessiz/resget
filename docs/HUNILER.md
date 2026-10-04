# Huniler ve KPI panosu

Platform pazarlama ekibinin bütün ağı tek bakışta gördüğü pano. `kpi_dashboard` anahtarının arkasındadır (varsayılan kapalı, BETA) ve yalnızca platform kiracısında açılır.

Panoya erişebilenler:
- `platform.marketing.view` iznine sahip platform pazarlama kullanıcıları,
- süper admin.

Pano yalnızca toplam sayı ve tutar gösterir. Hiçbir müşterinin, adayın veya restoran çalışanının adı ya da telefonu yanıtta yer almaz.

## Göstergeler

Dönem son 7, 30 veya 90 gündür (varsayılan 30). Platform kiracısı hiçbir sayıma girmez.

- **Restoran başına günlük sipariş** (belirleyici KPI, `CLAUDE.md`): dönemdeki sipariş sayısı ÷ dönemde sipariş alan restoran sayısı ÷ gün (`ordersPerRestaurantPerDay()`, iki ondalık). Ödenmemiş kartlı siparişler (`PENDING_PAYMENT`) sayılmaz.
- **Restoranlar**:
  - toplam etkin restoran,
  - pazaryerinde listelenen,
  - son 7 günde sipariş alan (aktif),
  - deneme süresindeki.
- **Siparişler**:
  - toplam,
  - kanala göre (masa QR, restoran sitesi, pazaryeri, telefon),
  - ilk sipariş ve tekrar sipariş. İlk sipariş, ilk siparişi dönem içinde olan restoran müşterisi sayısıdır; tekrar sipariş, toplamdan geriye kalandır.
- **Ciro ve komisyon**: para birimi başına, satışa dönüşen siparişlerin ürün brüt toplamı ve platform komisyonu, minör birimde. Ödenmemiş, iptal edilen, reddedilen ve iade edilen siparişler sayılmaz (`CONVERSION_EXCLUDED_ORDER_STATUSES`). Farklı para birimleri asla toplanmaz.
- **Günlük sipariş**: UTC gününe göre, dönemin her günü yer alır (siparişsiz günler sıfır). Ekranda tek seriden oluşan çubuk grafik var; her çubuğun üzerine gelindiğinde tarih ve sayı görünür.
- **İlçeler**: konsoldaki ilçe yoğunluğu (`AdminService.density`). İlçe başına restoran, listelenen, sipariş, restoran başına günlük sipariş ve lansman durumu gösterilir.

## Huniler

- **Masa QR hunisi**: dönemde menüyü açan, siparişe başlayan ve sipariş veren farklı anonim oturum sayısı (`qr_scan_events`, oturum başına bir kez sayılır).
- **Restoran hunisi**:
  - dönemde platform kiracısına eklenen kişi (aday) sayısı;
  - aynı dönemde kayıt olan restoranlar ve bunlardan kaç tanesinin listelendiği, ilk siparişini aldığı ve son 7 günde aktif olduğu (kohort).

Her adımın yanında bir önceki adıma oranı yazar (`funnelStepRates()`); önceki adım boşsa oran gösterilmez.

## API

`GET /platform/kpi?days=7|30|90` (oturum açmış kullanıcı).
- Platform erişimi yoksa `PLATFORM_ACCESS_DENIED`.
- Modül kapalıysa `FEATURE_DISABLED`.
- Desteklenmeyen dönemse `VALIDATION`.

Yanıt: `PlatformKpiDTO` (`packages/shared/src/kpi.ts`).

## Ekran

`/pazarlama/huniler`. Pazarlama gezinmesinde ve özet sayfasında bağlantısı var. Sayfada:
- dönem seçimi,
- dört gösterge kutusu,
- günlük çubuk grafik,
- iki huni,
- kanallar,
- ciro ve komisyon,
- ilçe tablosu.

Grafik yalnızca işletme renk değişkenlerini kullanır (`chart-bar`, `funnel-fill`); ayrıca renk tanımlanmaz.

## Sonraki adımlar

- İlçe ve mutfağa göre kırılım filtresi.
- Pazaryeri ziyaret hunisi (atıf verisiyle).
- Haftalık e-posta özeti.

## Testler

- `packages/shared/src/kpi.spec.ts`: KPI formülü, huni oranları, dönem doğrulaması.
- `apps/api/test/e2e/kpi.e2e-spec.ts`:
  - erişim ve modül anahtarı;
  - sipariş, kanal, ilk sipariş, günlük seri, ciro ve komisyon;
  - masa QR ve restoran hunileri;
  - KPI formülü;
  - yanıtta kişisel veri olmaması.
- `apps/web/e2e/kpi.e2e.ts`: kapalıyken 404, gezinme, göstergeler, huniler, ilçeler, dönem değişimi.
