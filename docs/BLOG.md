# Blog

Platform sitesinin blogu. Yazılar sayfa motorunun bloklarıyla yazılır (`docs/SAYFA_MOTORU.md`) ve aynı ekrandan yönetilir. Modül `blog` anahtarının arkasındadır (varsayılan kapalı, BETA) ve `page_engine` de açık olmalıdır. İkisi de yalnızca platform kiracısı için anlamlıdır.

## Yazı

- **Sayfalar** ekranında (`/pazarlama/sayfalar`) yeni kayıtta **Tür: Blog yazısı** seçilir. Tür seçimi yalnızca `blog` açıkken görünür. Anahtar kapalıyken yazı oluşturmak veya düzenlemek `FEATURE_DISABLED` ile reddedilir.
- Adres tek bölümdür (`masa-qr-menu`). Yazı `/blog/<dil>/<adres>` altında açılır.
- Adres dil başına tekildir ve sayfalarla ortaktır. Aynı dilde aynı adresi taşıyan bir sayfa ile yazı birlikte olamaz (`SITE_PAGE_PATH_TAKEN`).
- **Yazar** isteğe bağlıdır. Boş bırakılırsa yazının altında platformun adı görünür ve yapılandırılmış veride yazar bir kuruluş (`Organization`) olarak geçer; doluysa kişi (`Person`) olarak geçer.
- Başlık, açıklama, çeviri anahtarı ve durum sayfalardaki gibidir. İlk yayın tarihi yazının tarihi olarak gösterilir; sonraki düzenlemeler "değiştirilme" tarihidir.
- Yazının başlığı sayfanın tek `h1` başlığıdır; bloklardaki giriş bandı başlıkları `h2` olur.

## Herkese açık

| Adres | Ne gösterir |
| --- | --- |
| `/blog` | Yayımlanmış yazılar, en yeni önce. Ziyaretçinin dilindeki yazılar üste çıkar; her yazı kendi dilinde ve adresinde kalır. |
| `/blog/<dil>/<adres>` | Yazı: başlık, yazar ve tarih, bloklar. `BlogPosting` ve `BreadcrumbList` yapılandırılmış verisi; soru bloğu varsa `FAQPage`. Dil karşılıkları hreflang ile. |

Yazılar ve `/blog` site haritasına girer, yayımlanınca ve değişince IndexNow ile bildirilir (`docs/SEO.md`). Anahtar kapatılınca yazılar 404 olur, site haritasından ve `llms.txt` dosyasından düşer; kayıtlar silinmez.

## API

Sayfa uçları yazılar için de kullanılır (`/restaurants/:restaurantId/site/pages`; gövdede `kind: "POST"` ve isteğe bağlı `authorName`). Herkese açık:

| Uç | Ne döner |
| --- | --- |
| `GET /public/site/blog` | Platformun adı ve yayımlanmış yazılar (en çok 100). |
| `GET /public/site/page?locale=&path=&kind=POST` | Yazı. |

Veri: `site_pages` satırına `kind` (`PAGE` / `POST`) ve `authorName` eklendi. Migration: `20261109000000_blog`.

## Sonraki adımlar

- RSS / Atom akışı.
- Etiketler ve kategori sayfaları.
- Kapak görseli (görsel bloğuyla birlikte).
