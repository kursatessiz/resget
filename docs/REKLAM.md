# Reklam entegrasyonları

İşletme (ve platform kiracısı) kendi Meta, Google Ads ve TikTok reklam hesaplarını bağlar. Atıf modülünün kaydettiği dönüşümler sunucudan reklam platformlarının dönüşüm API'lerine gider, günlük harcama geri gelir ve reklam getirisi hesaplanır. Modül `ad_integrations` anahtarının arkasındadır (varsayılan kapalı, BETA) ve PRO analitiğin parçasıdır (`@RequirePlanFeature('analytics')`).

## Hesap bağlama

| Platform | Alanlar | Gizli |
| --- | --- | --- |
| Meta | Piksel kimliği, erişim jetonu, reklam hesabı kimliği (harcama için, isteğe bağlı), test etkinlik kodu (isteğe bağlı) | Erişim jetonu |
| Google Ads | Müşteri kimliği, dönüşüm işlemi kimliği, yenileme jetonu, yönetici hesap kimliği (isteğe bağlı) | Yenileme jetonu |
| TikTok | Piksel kodu, erişim jetonu, reklamveren kimliği (harcama için, isteğe bağlı) | Erişim jetonu |

- Bilgiler kaydedilmeden önce platformda doğrulanır. Platform reddederse `AD_CREDENTIALS_REFUSED`, alan eksik veya tanınmıyorsa `AD_CREDENTIALS_INVALID` döner.
- Tüm bilgiler `CredentialCipher` ile (AES-256-GCM, anahtar sürümlü) şifreli saklanır. Gizli alanlar hiçbir yanıtta yer almaz; ekranda yalnızca "kayıtlı" diye görünür. Gizli alan boş bırakılarak yapılan güncelleme kayıtlı değeri korur.
- Google Ads için uygulama bilgileri ortamdan gelir: `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`. İşletme yalnızca kendi yenileme jetonunu girer.
- `ADS_PROVIDER=LIVE` gerçek API'leri çağırır. `MOCK` geliştirme ve testte kabul eder, üretimde reddeder; böylece hiçbir dönüşüm gönderilmiş gibi görünmez.

## Dönüşüm gönderimi

1. Atıf bir dönüşüm kaydettiğinde (`AttributionService.record`), türü bağlantının listesinde olan her etkin veya duraklatılmış bağlantı için bir gönderim kuyruğa girer (`ad_conversion_deliveries`). Varsayılan türler: restoranda ilk ve tekrar sipariş; platform kiracısında aday, restoran kaydı ve ilk ödeme.
2. Çalıştırıcı (`AdsRunner`, dakikada bir) zamanı gelen gönderimleri işler:
   - **Reklam izni**: dönüşümün son teması reklam çerezlerine izin verilmiş bir ziyaret değilse gönderilmez (`SKIPPED`, `NO_AD_CONSENT`).
   - **Tıklama kimliği**: Meta için `fbclid` (`fbc` olarak), Google için `gclid` / `gbraid` / `wbraid`, TikTok için `ttclid`. Google her zaman ister. Meta ve TikTok, yalnızca gelişmiş eşleşme açıksa tıklama kimliği olmadan da gönderilir. Aksi halde `NO_CLICK_ID`.
   - **Gelişmiş eşleşme** (varsayılan kapalı): telefon (rakamlar) ve küçük harfli e-posta SHA-256 özeti olarak eklenir. Bu, reklam platformuna kişisel veri aktarımıdır ve çoğu durumda yurt dışına aktarım sayılır. İşletme yalnızca müşterilerinden bu aktarım için açık rıza aldıysa açmalıdır; ekran bunu açıkça söyler.
   - **Tekilleştirme**: platformun kendi pikseli veya etiketiyle aynı dönüşümü iki kez saymamak için dönüşüm kimliği olay kimliği (Meta `event_id`, TikTok `event_id`, Google `orderId`) olarak gönderilir.
   - **Değer**: dönüşümün tutarı para biriminin ondalık basamağına göre ondalık sayı olarak gönderilir (`minorToDecimalString()`).
3. Geçici hata (ağ, 429, 5xx) üstel bekleme ile tekrar denenir (2, 4, 8, 16 dakika; en fazla 5 deneme), sonra `FAILED` olur. Platform kimlik bilgilerini reddederse bağlantı `ERROR` durumuna geçer ve gönderimler bekler; bilgiler yenilenince kaldığı yerden devam eder.
4. Meta ve TikTok yedi günden eski olayları kabul etmez. Yedi günden eski bekleyen gönderimler `TOO_OLD` ile atlanır.
5. Modül kapalıyken kuyruk bekler, gönderim yapılmaz.

## Harcama

Etkin bağlantıların son 7 günlük kampanya harcaması en fazla 6 saatte bir çekilir; "Harcamayı şimdi çek" ile hemen de çekilebilir. Kayıtlar `ad_spend_daily` tablosuna yazılır: bağlantı, gün ve kampanya başına tekildir, tekrar çekmede güncellenir. Tutarlar platformun bildirdiği ondalık değerden float kullanılmadan minör birime çevrilir (`decimalToMinor()`, Google için `microsToMinor()`).

Para birimi:
- Meta hesap para birimini, Google müşteri para birimini bildirir.
- TikTok raporu para birimi taşımaz; işletmenin para birimi kullanılır.

## Performans raporu

`GET performance?days=7|30|90` platform ve para birimi başına şunları verir:
- harcama, gösterim ve tıklama;
- son teması o platformdan gelen dönüşüm sayısı ve değeri (`docs/ATIF.md`);
- reklam getirisi (gelir ÷ harcama, baz puan).

Para birimleri asla karıştırılmaz; her biri ayrı satırdır.

## API

`/restaurants/:restaurantId/ads`, `@RequireFeature('ad_integrations')`, `@RequirePlanFeature('analytics')`:

- `GET connections`, `PUT connections/:platform`, `PATCH connections/:platform` (durum, türler, gelişmiş eşleşme), `DELETE connections/:platform`, `POST spend/sync` (`integrations.manage`).
- `GET performance` (`reports.view`).

## Ekranlar

- `/panel/<slug>/entegrasyon`: modül açıksa ve plan PRO ise "Reklam hesapları" kartları ve "Reklam performansı" tablosu. Her platform kartında şunlar var:
  - bilgiler,
  - bağla / kaydet,
  - gönderilecek türler,
  - gelişmiş eşleşme ve uyarısı,
  - gönderim sayaçları, son gönderim ve son hata,
  - duraklat / sürdür ve bağlantıyı kaldır.
- `/pazarlama/reklam`: aynı ekran platform kiracısında. Türler aday, restoran kaydı ve ilk ödemedir.

## Dış onaylar

Gerçek gönderim için şunlar gerekir:
- Meta için iş hesabı ve piksel erişim jetonu.
- Google Ads API için geliştirici jetonu (temel erişim onayı) ve OAuth uygulaması.
- TikTok için Events API erişim jetonu.

Bu başvurular haftalar sürebilir (`docs/PAZARLAMA.md`). API sürümleri sabittir: Meta Graph `v21.0`, Google Ads `v18`, TikTok `v1.3`. Platform bir sürümü emekliye ayırdığında adaptördeki sabit güncellenir.

## Veri

- `ad_connections`: kiracı ve platform başına tekil; şifreli bilgiler, anahtar sürümü, görünür alanlar, türler, gelişmiş eşleşme, durum, son gönderim, son harcama çekimi, son hata.
- `ad_conversion_deliveries`: bağlantı ve dönüşüm başına tekil; durum, deneme, sonraki deneme, hata.
- `ad_spend_daily`: bağlantı, gün ve kampanya başına harcama, gösterim, tıklama.

Migration: `20261107000000_ad_integrations`.

## Testler

- `packages/shared/src/ads.spec.ts`: ondalık ve mikro çevrimleri, ondalık metin, Meta `fbc`, bilgi denetimi.
- `apps/api/src/modules/ads/adapters.spec.ts`: Meta, TikTok ve Google isteklerinin biçimi, yetki ve geçici hata eşlemesi, Google kısmi hata ve yapılandırma eksikliği (sahte `fetch` ile, gerçek ağ yok).
- `apps/api/test/e2e/ads.e2e-spec.ts`:
  - modül anahtarı, şifreli saklama, yanıtlarda gizli bilgi olmaması;
  - reklam izni ve tıklama kimliği kuralları;
  - gelişmiş eşleşme özetleri ve türler;
  - tekrar deneme;
  - harcama ve performans raporu, bağlantı silme.
- `apps/web/e2e/ads.e2e.ts`: kapalıyken kart yok, Meta bağlama, gelişmiş eşleşme, harcama çekme, bağlantıyı kaldırma.
