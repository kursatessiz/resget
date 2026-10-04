# Sayfa motoru

Platformun kendi sitesindeki sayfalar kod değişikliği olmadan bloklarla kurulur; açılan her ilçe için ilçe sayfası kendiliğinden oluşur. Modül `page_engine` anahtarının arkasındadır (varsayılan kapalı, BETA). Teknik SEO kuralları (site haritası, `robots.txt`, başlıklar, kanonik adres, dil karşılıkları, yapılandırılmış veri) `docs/SEO.md` içindedir.

## Kimin sayfaları

- Motor sayfaları yalnızca platform kiracısına aittir (`isPlatform`). Restoranın sitesi kendi sipariş sayfasıdır (`docs/VITRIN.md`); bir restoran için sayfa uçları `PLATFORM_ONLY` ile reddedilir.
- Anahtar platform kiracısı için açılmadan hiçbir sayfa, ilçe sayfası veya site haritası girdisi yayınlanmaz; herkese açık uçlar 404 döner.
- Ekran: Pazarlama alanında **Sayfalar** (`/pazarlama/sayfalar`). Görmek için `platform.marketing.view`, yazmak için `platform.marketing.manage` veya `platform.marketing.send` gerekir (restoran izinleri `campaigns.view` / `campaigns.manage`).

## Sayfa

| Alan | Kural |
| --- | --- |
| Adres | Küçük harf, rakam ve tire; en çok üç bölüm (`restoranlar-icin`, `rehber/qr-menu`). Dil başına tekil (`SITE_PAGE_PATH_TAKEN`). |
| Dil | Dil kodu (`tr`, `en`, `de-AT` gibi). Sayfa `/p/<dil>/<adres>` altında açılır. |
| Arama sonucu başlığı | 3 ile 70 karakter; 60 civarı tam görünür. |
| Arama sonucu açıklaması | 10 ile 160 karakter; 155 civarı tam görünür. |
| Çeviri anahtarı | İsteğe bağlı. Aynı anahtarı taşıyan yayımlanmış sayfalar birbirinin dil karşılığıdır (hreflang). |
| Durum | `DRAFT` (varsayılan) veya `PUBLISHED`. Taslak herkese açık değildir. İlk yayın tarihi saklanır; yayından kaldırmak tarihi silmez. |
| Bloklar | 1 ile 30 blok. |

## Bloklar

Bütün blok alanları düz metindir; HTML hiçbir zaman işlenmez. Uzun metinde boş satır yeni paragraf başlatır. Bağlantılar yalnızca site içi adres (`/` ile başlar, `//` ile başlamaz) veya `https://` adresi olabilir.

| Blok | Alanlar |
| --- | --- |
| `hero` (Giriş bandı) | Başlık, alt başlık, buton metni ve bağlantısı (isteğe bağlı). Sayfadaki ilk giriş bandının başlığı sayfanın tek `h1`'idir; giriş bandı yoksa sayfa başlığı `h1` olur. |
| `text` (Metin) | Başlık (isteğe bağlı), metin (en çok 2000 karakter). |
| `features` (Özellikler) | Başlık, 1 ile 6 öğe (başlık ve metin). |
| `faq` (Sık sorulan sorular) | Başlık, 1 ile 12 soru ve yanıt. Sayfadaki bütün sorular tek `FAQPage` yapılandırılmış verisi olarak da yayınlanır. |
| `cta` (Çağrı) | Başlık, metin, buton metni ve bağlantısı. |
| `restaurants` (İlçe restoranları) | Başlık ve ilçe (`ÜLKE|şehir|ilçe`). Sayfa açıldığında o ilçenin pazaryerinde listelenen restoranları gösterilir (pazaryeriyle aynı kural, `docs/VITRIN.md`); ilçe kapalıysa blok boş kalır. |

Kaydedilen bloklar okunurken yeniden doğrulanır; artık geçmeyen bir blok gösterilmez.

## İlçe sayfaları

- Lansmanı yapılmış her hizmet alanı için `/ilce/<şehir>/<ilçe>` sayfası vardır (`districtPath()`; Türkçe karakterler sadeleşir: `Kadıköy` -> `kadikoy`).
- Sayfa elle düzenlenmez: ilçenin listelenen restoranları, pazaryerine bağlantı, başlık ve açıklama i18n anahtarlarından gelir (`site.district.*`).
- Lansmanı geri alınan ilçenin sayfası 404 olur ve site haritasından düşer.

## API

`/restaurants/:restaurantId/site/pages`, `@RequireFeature('page_engine')`, yalnızca platform kiracısı:

| Uç | İzin |
| --- | --- |
| `GET /` | `campaigns.view` |
| `POST /` | `campaigns.manage` |
| `GET /:pageId` | `campaigns.view` |
| `PUT /:pageId` | `campaigns.manage` (tam güncelleme) |
| `DELETE /:pageId` | `campaigns.manage` |

Herkese açık (`/public/site`, istemci başına dakikada 600 istek, `PUBLIC_SITE_RATE_LIMIT` ile değişir):

| Uç | Ne döner |
| --- | --- |
| `GET /page?locale=&path=` | Yayımlanmış sayfa, dil karşılıkları ve restoranları çözülmüş bloklar. |
| `GET /districts/:city/:district` | İlçe sayfası verisi. |
| `GET /restaurants/:slug` | Restoran sayfasının SEO verisi (`docs/SEO.md`). |
| `GET /sitemap` | Site haritası girdileri. |

Hata kodları: `SITE_PAGE_NOT_FOUND`, `SITE_PAGE_PATH_TAKEN`, `PLATFORM_ONLY`.

Veri: `site_pages` (`docs/VERI_MODELI.md`). Migration: `20261108000000_page_engine`.

## Sonraki adımlar

- Mutfak türü açılış sayfaları (mutfak türü menü verisinde henüz yok).
- Blog, IndexNow ve `llms.txt` (yol haritası 12. madde).
- Görsel bloğu (yükleme ve alternatif metinle).
