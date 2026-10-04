# Ziyaret ölçümü ve atıf

Restoranın sipariş sayfaları (`/<slug>`, masa QR `/m/<token>`, kendi alan adı) ve platformun kendi sitesi (`/`), bir ziyaretin nereden geldiğini kaydeder: UTM etiketleri, reklam tıklama kimlikleri, masa QR kodu, yönlendiren site. Ziyaretçi sipariş verdiğinde, kaydolduğunda veya formu doldurduğunda sunucu ziyaretçiyi kişiye (`RestaurantCustomer`) bağlar ve dönüşüm kişinin ziyaretlerine atfedilir. Pazarlama yönetim paketi yol haritasının 3. maddesidir (`docs/PAZARLAMA.md`). Kardeş platformdaki atıf tasarımı örnek alınmıştır; o depoya dokunulmaz.

`attribution` modül anahtarının arkasındadır (varsayılan kapalı, BETA). Kapalıyken sayfalarda bant ve ölçüm yoktur, takip ucu hiçbir şey saklamaz, dönüşüm yazılmaz, rapor ucu `FEATURE_DISABLED` döner ve kişi kartında ziyaret bölümü görünmez. Rapor PRO `analytics` özelliğidir.

## Gizlilik kuralları

- İzin olmadan hiçbir şey yazılmaz ve gönderilmez (izin gereken bölgelerde).
- Açılış adresinden yalnızca host ve yol saklanır; sorgu dizesinin takip dışı kısmı ve parça atılır. Yönlendirenden yalnızca host saklanır (aynı site ise boş).
- IP adresi hiçbir yerde saklanmaz. Ülke yalnızca kenar vekil başlığından (`CF-IPCountry` veya `X-Country-Code`) alınır.
- Reklam tıklama kimlikleri (`gclid`, `gbraid`, `wbraid`, `fbclid`, `ttclid`, `msclkid`, `li_fat_id`) yalnızca reklam izniyle saklanır. UTM değerleri ve kendi kampanya kimliklerimiz ölçüm izniyle saklanır.
- Bot filtresi: bilinen tarayıcı botları, bağlantı önizlemeleri, izleme servisleri, komut satırı istemcileri; boş User-Agent da bot sayılır.
- Herkese açık bir "tanımla" ucu yoktur. Bağlama yalnızca kişiyi zaten bilen sunucu akışlarında olur: sipariş, restoran kaydı, platform formu.

## Çerez bandı

Bölge sırasıyla kenar vekil başlığından, sonra tarayıcının ilk dil tercihinin bölge alt etiketinden (`tr-TR` -> TR) çözülür; hiçbiri yoksa en katı davranış uygulanır (`consentRegimeFor()`, `visitorCountry()`).

| Rejim | Bölge | Davranış |
|---|---|---|
| `OPT_IN` | AB/AEA, Birleşik Krallık, İsviçre, Kanada, bilinmeyen | Tümünü kabul et / Tümünü reddet / Tercihleri seç; izinden önce hiçbir şey |
| `KVKK` | Türkiye | KVKK metniyle kabul / ret / tercih; açık rıza olmadan hiçbir şey |
| `NOTICE` | Diğerleri | Bilgilendirme bandı, ölçüm hemen başlar; "Reklam çerezlerini kapat" seçeneği |

Global Privacy Control sinyali reklam iznini her durumda kapatır. Reklam izni ölçüm izni olmadan verilemez. Tercih kaydedildikten sonra sayfanın altındaki "Çerez tercihleri" bağlantısı bandı yeniden açar; ölçüm izni geri alınırsa ziyaretçi ve oturum çerezleri silinir.

Çerezler (birinci taraf):
- `rg_consent` (zorunlu, 180 gün): `<sürüm>.<ölçüm 0|1>.<reklam 0|1>`. Bant amaçları değişirse `CONSENT_VERSION` artırılır ve herkese yeniden sorulur.
- `rg_vid` (ölçüm izniyle, 13 ay): anonim ziyaretçi kimliği.
- `rg_sid` (ölçüm izniyle, 30 dakika hareketsizlikte biter): ziyaret oturumu.

Masa QR hunisinin anonim oturum çerezi (`resget_qr_session`, `docs/MASA_QR.md`) ayrı ve değişmeden çalışır.

## Akış

1. Sayfa, sunucuda rejimi hesaplar ve `ConsentManager` bileşenini çizer (`StorefrontDTO.tracking` veya `GET /public/platform/site` açıkken).
2. Ölçüm izni varsa tarayıcı her oturumun ilk sayfasında ve URL takip parametresi taşıdığında `POST /public/track/:hedef/touchpoint` gönderir (BFF üzerinden). `hedef` restoran slug'ı veya platform sitesi için `platform`'dur; masa QR sayfası `tableToken` da gönderir.
3. Uç her durumda 204 döner (bilinmeyen restoran, bot, izin yokluğu ve başarılı kayıt dışarıdan ayırt edilemez). İstemci adresi başına dakikada 60 istek sınırı vardır.
4. BFF, `rg_vid` çerezini yalnızca ölçüm izni varken API'ye `x-visitor-id` başlığıyla iletir; sayfanın gönderdiği aynı adlı başlık silinir.
5. Sipariş (`/public/qr/:token/orders`, `/public/restaurants/:slug/orders`), restoran kaydı (`POST /restaurants`) ve platform formu bu başlığı okuyup ziyaretçiyi kişiye bağlar; ziyaretçinin kişisiz eski ziyaretleri de kişiye eklenir. Tanınmış ziyaretçinin sonraki ziyaretleri doğrudan kişiye yazılır.

## Dönüşümler

`ConversionEvent` satırı `(kiracı, sourceKind, sourceId)` üzerinde tekildir; tekrar eden kanca veya eşzamanlı çağrı ikinci satır yazmaz. Kayıt anında 30 günlük pencere içindeki son ziyaret satırda saklanır ve kişinin geçmişine `CONVERSION` etkinliği yazılır. Dönüşüm yazımı iş akışını asla engellemez; hata yalnızca loglanır.

| Tür | Kiracı | Ne zaman | `sourceKind` / `sourceId` | Değer |
|---|---|---|---|---|
| `first_order` | Restoran | Müşterinin bu restorandaki ilk tamamlanan siparişi (`DELIVERED`, `PICKED_UP`) | `order` / sipariş | Müşteriden alınan tutar |
| `repeat_order` | Restoran | Sonraki tamamlanan siparişler | `order` / sipariş | Müşteriden alınan tutar |
| `lead` | Platform | Platform sitesindeki formdan aday | `lead_contact` / kişi (kişi başına bir kez) | yok |
| `restaurant_signup` | Platform | Restoran kaydı (kendi kaydı veya konsol), sahibin kişisine | `restaurant` / yeni restoran | yok |
| `first_payment` | Platform | Restoranın ilk ödenen komisyon faturası | `restaurant_first_payment` / restoran | Fatura toplamı |

Platform dönüşümleri yalnızca platform kiracısı kurulu ve onda `attribution` açıkken yazılır. Kişi yoksa açılır (kaynak `signup` veya `site_form`, şirket = restoran adı); platform satış hattında aşama yoksa varsayılan aşamalar oluşturulur ve yeni kişi "Aday" aşamasına girer.

## Platform aday formu

Açılış sayfasında "Restoranınız için bilgi alın" kartı, platform kiracısında `marketing_platform` ve `contacts_crm` açıkken görünür. `POST /public/platform/leads`: ad, telefon, restoran adı, isteğe bağlı il ve ilçe, aydınlatma metni onayı (zorunlu). Yeni veya bilinen telefon için yanıt aynıdır (204), form kişi sorgulamak için kullanılamaz. İstemci adresi başına 10 dakikada 5 istek. Her gönderim kişiye `FORM` etkinliği yazar; `lead` dönüşümü kişi başına bir kezdir. Formda ayrı ve işaretsiz bir SMS pazarlama izni kutusu vardır; işaretlenirse izin `SITE_FORM` kaynağıyla yazılır (`docs/RIZA.md`). Formdan ve kayıttan gelen kişiler işletme (tacir) olarak açılır.

## Rapor

`GET /restaurants/:id/attribution?model=&groupBy=&from=&to=` (`reports.view`, PRO `analytics`, anahtar `attribution`). Panelde `/panel/<slug>/atif`, Pazarlama alanında `/pazarlama/atif` ("Atıf" menüsü).

- **Modeller**: `LAST_TOUCH` (varsayılan; dönüşümden önceki 30 gün içindeki son ziyaret), `FIRST_TOUCH` (kişinin bilinen ilk ziyareti, pencere yok), `LINEAR` (pencere içindeki ziyaretler eşit pay alır; sayılar kesirli, gelir `shareOf()` ile tam sayı minör birimde bölünür).
- **Kırılım**: kaynak (`utm_source`, yoksa reklam platformu, yoksa masa QR için `qr`, yoksa yönlendiren host, yoksa doğrudan), ortam (`utm_medium`, yoksa reklamda `cpc`, QR'da `table`, yönlendirende `referral`), kampanya (`rg_cid`, yoksa `utm_id`, yoksa `utm_campaign`). Kimlikler addan önce gelir; kampanyanın adı değişse de satırı bozulmaz.
- Ziyareti ölçülmemiş dönüşümler "Doğrudan" satırına yazılır. Yanıt ayrıca dönemdeki ölçülen ziyaret sayısını ve kampanya kimliği olmayan ücretli tıklama sayısını verir.
- En fazla 366 günlük aralık; tür listesi kiracıya göredir (restoran: ilk ve tekrar sipariş; platform: aday, kayıt, ilk ödeme).

Kendi reklam bağlantılarında `rg_cid` (kampanya), `rg_asid` (reklam seti) ve `rg_adid` (reklam) kimliklerini kullanın; tavsiye kodu için `rg_ref` ayrılmıştır (yol haritası 13. madde).

## Kişi kartı

CRM kişi kartı (`docs/CRM.md`), modül açıkken son 20 dönüşümü (tür ve son temas kaynağı) ve son 20 ziyareti (kaynak, ortam, açılış yolu, masa) gösterir (`ContactDetailDTO.attribution`).

## Veri

`visitors` (`(restaurantId, id)` birincil anahtar, bağlı kişi), `touchpoints` (yukarıdaki alanlar, reklam izni, etiketsiz ücretli trafik işareti, cihaz türü, masa, kişi), `conversion_events` (tür, tutar ve para birimi, kaynak, atfedilen ziyaret). Migration'lar: `20261101000000_attribution`, `20261101000001_contact_activity_conversion` (`FORM` ve `CONVERSION` etkinlik türleri).

## Sonraki adımlar

Kiracı ayarı olarak atıf penceresi ve tavsiye kodlarının ödüle bağlanması (13. madde). Reklam platformlarına dönüşüm gönderimi `docs/REKLAM.md`, huniler ve KPI panosu `docs/HUNILER.md`, kişi düzeyinde kanal izinleri `docs/RIZA.md` ile geldi.
