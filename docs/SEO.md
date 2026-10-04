# Teknik SEO

Arama motorlarının platform sitesini ve restoran sayfalarını doğru okuması için kurallar. Sayfa motoru: `docs/SAYFA_MOTORU.md`.

## Site adresi

Web uygulaması mutlak adresleri `WEB_DOMAIN` ortam değişkeninden kurar (`https://<WEB_DOMAIN>`, `publicSiteUrl()`); tanımlı değilse geliştirme adresi `http://localhost:3000` kullanılır. Üretim compose dosyası bu değişkeni web servisine zaten verir.

## robots.txt

Her zaman yayınlanır (`app/robots.ts`). Herkese izin verir, şu yolları dışarıda tutar (`ROBOTS_DISALLOW`): `/panel`, `/admin`, `/pazarlama`, `/hesabim`, `/giris`, `/kayit`, `/api`, `/t/` (sipariş takibi), `/j/` (davet), `/iptal/` (abonelikten çıkma), `/onay/` (çift onay). Site haritası satırı yalnızca platform alan adında bulunur. Masa QR sayfaları (`/m/<token>`) engellenmez: engellenen sayfa kanonik etiketini de okutamaz; bunun yerine her masa sayfası restoran sayfasını kanonik adres olarak gösterir ve arama motoru onları tek sayfada birleştirir.

## sitemap.xml

`app/sitemap.ts`, API'nin `GET /public/site/sitemap` listesini mutlak adrese çevirir. `page_engine` platform kiracısı için kapalıyken boştur. Açıkken:

- Ana sayfa ve `/pazaryeri`.
- Lansmanı yapılmış her ilçenin sayfası (son değişiklik: lansman tarihi).
- Pazaryerinde listelenen (askıda olmayan, pazaryeri modülü açık) her restoranın `/<slug>` sayfası. Doğrulanmış kendi alan adı olan restoran eklenmez; onun kanonik adresi kendi alan adıdır ve başka bir alan adının haritasına giremez.
- Yayımlanmış her motor sayfası; dil karşılıkları `xhtml:link` ile.
- `blog` açıkken `/blog` ve yayımlanmış her yazı (`docs/BLOG.md`).

Bir restoranın kendi alan adına gelen istekte site haritası boştur (bu alan adı yalnızca restoranın ana sayfasını sunar).

## IndexNow

Herkese açık bir adres değiştiğinde arama motorlarına haber verilir (IndexNow; Bing, Yandex, Seznam, Naver ve diğerleri paylaşır, Google kullanmaz). Bildirim yalnızca `page_engine` platform kiracısı için açıkken gider ve hiçbir zaman değişikliği bekletmez veya bozmaz; hata yalnızca loglanır.

| Olay | Bildirilen adres |
| --- | --- |
| Sayfa yayımlandı, değişti, yayından kalktı, silindi | `/p/<dil>/<adres>` (adres değiştiyse eskisi de) |
| Blog yazısı aynı olaylar | `/blog/<dil>/<adres>` ve `/blog` |
| İlçe lansmanı açıldı veya kapandı | `/ilce/<şehir>/<ilçe>` |
| Restoran pazaryerine alındı veya çıkarıldı | `/<slug>` |

Ayar (`.env.example`):

- `INDEXNOW_PROVIDER`: `NONE` (varsayılan, hiçbir şey yapmaz), `MOCK` (yalnızca kaydeder, testler), `LIVE` (`api.indexnow.org` adresine gönderir).
- `INDEXNOW_KEY`: 8 ile 128 harf, rakam veya tire. `LIVE` için zorunludur. Aynı değer web uygulamasına da verilir; web `/indexnow/<anahtar>.txt` adresinde anahtarı sunar, başka her dosya adına 404 döner.
- Mutlak adresler API'nin `PUBLIC_APP_URL` değerinden kurulur; üretimde bu `https://<WEB_DOMAIN>` olmalıdır.

## llms.txt

`/llms.txt` (llmstxt.org önerisi), dil modellerinin siteyi tanıması için kısa bir Markdown dizinidir. `page_engine` açıkken üretilir, kapalıyken ve restoranın kendi alan adında 404 döner. İçerik:

- Platformun adı ve tek cümlelik özeti (`site.llms.summary`, platform kiracısının dilinde).
- Temel bağlantılar: ana sayfa, pazaryeri, blog açıksa tüm yazılar.
- Yayımlanmış sayfalar ve yazılar (başlık, adres, açıklama).
- Açılan ilçeler.

Kiracı metni tek satıra indirgenir, köşeli parantez, bağlantı ve başlık işaretleri temizlenir (`markdownInline()`); böylece bir sayfa başlığı dosyaya kendi bağlantısını veya başlığını ekleyemez.

## Başlık, açıklama, kanonik adres

| Sayfa | Başlık ve açıklama | Kanonik |
| --- | --- | --- |
| Restoran sayfası (`/<slug>`) | `site.restaurant.metaTitle`; açıklama ilk şubenin ilçe ve şehriyle (`site.restaurant.metaDescription`). Her zaman, anahtardan bağımsız. | Doğrulanmış kendi alan adı varsa `https://<alan adı>/`, yoksa `/<slug>`. |
| Masa QR sayfası (`/m/<token>`) | Restoran sayfasıyla aynı. | Restoran sayfasının kanonik adresi. |
| Motor sayfası | Sayfanın kendi başlığı ve açıklaması. | `/p/<dil>/<adres>`; dil karşılıkları `alternates.languages` (hreflang). |
| İlçe sayfası | `site.district.metaTitle` / `metaDescription`. | `/ilce/<şehir>/<ilçe>`. |

Hepsi Open Graph başlık, açıklama ve adresini taşır; restoran sayfası logoyu görsel olarak verir. Kiracı verisi (restoran, ilçe adı) çevrilmez, çevresindeki metin etkin dile göre gelir. Motor sayfasının içeriği sayfanın dilindedir (`lang` özniteliği).

## Yapılandırılmış veri (schema.org JSON-LD)

| Sayfa | Tür | Koşul |
| --- | --- | --- |
| Restoran sayfası | `Restaurant` (ad, adres, logo, menü adresi) | `page_engine` o restoran için açık (`RestaurantSeoDTO.structuredData`). |
| Motor sayfası | `BreadcrumbList`; soru bloğu varsa `FAQPage` | Sayfa yayında. |
| Blog yazısı | `BlogPosting`, `BreadcrumbList`; soru bloğu varsa `FAQPage` | Yazı yayında, `blog` açık (`docs/BLOG.md`). |
| İlçe sayfası | `BreadcrumbList`; restoran varsa `ItemList` | İlçe lansmanlı. |

JSON-LD `serializeJsonLd()` ile yazılır: `<`, U+2028 ve U+2029 kaçışlanır, böylece kiracı metni betik etiketini kapatamaz. Puan (`aggregateRating`) eklenmez: Google, işletmenin kendi sitesinde topladığı puanları zengin sonuç için kabul etmez.

## Kontrol listesi (yayına almadan önce)

1. `WEB_DOMAIN` doğru alan adını gösteriyor.
2. Süper admin `page_engine`'i platform kiracısı için açtı; `/sitemap.xml` dolu.
3. Google Search Console ve Bing Webmaster Tools'a site haritası verildi (platform hesabıyla, elle).
4. Restoranlarda yapılandırılmış veri isteniyorsa anahtar genel olarak veya işletme bazında açıldı.
5. IndexNow için bir anahtar üretildi, `INDEXNOW_KEY` API ve web servislerine verildi, `INDEXNOW_PROVIDER=LIVE` yapıldı; `https://<WEB_DOMAIN>/indexnow/<anahtar>.txt` anahtarı gösteriyor.
