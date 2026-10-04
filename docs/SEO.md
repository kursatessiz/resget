# Teknik SEO

Arama motorlarının platform sitesini ve restoran sayfalarını doğru okuması için kurallar. Sayfa motoru: `docs/SAYFA_MOTORU.md`.

## Site adresi

Web uygulaması mutlak adresleri `WEB_DOMAIN` ortam değişkeninden kurar (`https://<WEB_DOMAIN>`, `publicSiteUrl()`); tanımlı değilse geliştirme adresi `http://localhost:3000` kullanılır. Üretim compose dosyası bu değişkeni web servisine zaten verir.

## robots.txt

Her zaman yayınlanır (`app/robots.ts`). Herkese izin verir, şu yolları dışarıda tutar (`ROBOTS_DISALLOW`): `/panel`, `/admin`, `/pazarlama`, `/hesabim`, `/giris`, `/kayit`, `/api`, `/t/` (sipariş takibi), `/m/` (masa QR oturumu), `/j/` (davet), `/iptal/` (abonelikten çıkma), `/onay/` (çift onay). Site haritası satırı yalnızca platform alan adında bulunur.

## sitemap.xml

`app/sitemap.ts`, API'nin `GET /public/site/sitemap` listesini mutlak adrese çevirir. `page_engine` platform kiracısı için kapalıyken boştur. Açıkken:

- Ana sayfa ve `/pazaryeri`.
- Lansmanı yapılmış her ilçenin sayfası (son değişiklik: lansman tarihi).
- Pazaryerinde listelenen (askıda olmayan, pazaryeri modülü açık) her restoranın `/<slug>` sayfası. Doğrulanmış kendi alan adı olan restoran eklenmez; onun kanonik adresi kendi alan adıdır ve başka bir alan adının haritasına giremez.
- Yayımlanmış her motor sayfası; dil karşılıkları `xhtml:link` ile.

Bir restoranın kendi alan adına gelen istekte site haritası boştur (bu alan adı yalnızca restoranın ana sayfasını sunar).

## Başlık, açıklama, kanonik adres

| Sayfa | Başlık ve açıklama | Kanonik |
| --- | --- | --- |
| Restoran sayfası (`/<slug>`) | `site.restaurant.metaTitle`; açıklama ilk şubenin ilçe ve şehriyle (`site.restaurant.metaDescription`). Her zaman, anahtardan bağımsız. | Doğrulanmış kendi alan adı varsa `https://<alan adı>/`, yoksa `/<slug>`. |
| Motor sayfası | Sayfanın kendi başlığı ve açıklaması. | `/p/<dil>/<adres>`; dil karşılıkları `alternates.languages` (hreflang). |
| İlçe sayfası | `site.district.metaTitle` / `metaDescription`. | `/ilce/<şehir>/<ilçe>`. |

Hepsi Open Graph başlık, açıklama ve adresini taşır; restoran sayfası logoyu görsel olarak verir. Kiracı verisi (restoran, ilçe adı) çevrilmez, çevresindeki metin etkin dile göre gelir. Motor sayfasının içeriği sayfanın dilindedir (`lang` özniteliği).

## Yapılandırılmış veri (schema.org JSON-LD)

| Sayfa | Tür | Koşul |
| --- | --- | --- |
| Restoran sayfası | `Restaurant` (ad, adres, logo, menü adresi) | `page_engine` o restoran için açık (`RestaurantSeoDTO.structuredData`). |
| Motor sayfası | `BreadcrumbList`; soru bloğu varsa `FAQPage` | Sayfa yayında. |
| İlçe sayfası | `BreadcrumbList`; restoran varsa `ItemList` | İlçe lansmanlı. |

JSON-LD `serializeJsonLd()` ile yazılır: `<`, U+2028 ve U+2029 kaçışlanır, böylece kiracı metni betik etiketini kapatamaz. Puan (`aggregateRating`) eklenmez: Google, işletmenin kendi sitesinde topladığı puanları zengin sonuç için kabul etmez.

## Kontrol listesi (yayına almadan önce)

1. `WEB_DOMAIN` doğru alan adını gösteriyor.
2. Süper admin `page_engine`'i platform kiracısı için açtı; `/sitemap.xml` dolu.
3. Google Search Console ve Bing Webmaster Tools'a site haritası verildi (platform hesabıyla, elle).
4. Restoranlarda yapılandırılmış veri isteniyorsa anahtar genel olarak veya işletme bazında açıldı.
