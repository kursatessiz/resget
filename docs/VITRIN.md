# Vitrin: masa QR sayfası, restoran sayfası ve pazaryeri

Tüketici yüzeyi Faz 0'da web'dir ve uygulama kurulumu istemez (`HANDOVER.md`). Üç giriş vardır ve üçü de aynı sipariş oluşturma yolundan geçer (`OrdersService.create`): fiyat, ücret, hakediş anlık görüntüsü ve başlangıç durumu sunucuda belirlenir; tarayıcıdaki toplamlar yalnızca ön izlemedir.

## Sayfalar

- **Masa QR** (`/m/<token>`, `GET /public/qr/:token`): menü (görünür kategoriler, satıştaki seçenek grupları), masa, kabul edilen ödeme yöntemleri ve sipariş seçenekleri (`ordering`: masaya, gel al, eve teslim; ücret politikası; kurye ağından teklif alınıp alınmadığı). Sepete ilk ürün eklenince `POST /public/qr/:token/funnel` ile `STARTED_ORDER`, sipariş verilince `PLACED_ORDER` yazılır; anonim oturum `resget_qr_session` çerezidir ve BFF bunu `x-qr-session` başlığı olarak API'ye taşır (`docs/MASA_QR.md`).
- **Restoran sayfası** (`/<slug>`, `GET /public/restaurants/:slug/menu`): aynı menü ve sepet, masa seçeneği olmadan; eve teslim ve gel al. Uygulama yolları (`giris`, `kayit`, `panel`, `admin`, `m`, `t`, `j`, `pazaryeri` vb.) `RESERVED_SLUGS` ile slug olamaz.
- **Pazaryeri** (`/pazaryeri`, `GET /public/marketplace/areas` ve `GET /public/marketplace?countryCode&city&district`): açılmış hizmet alanlarından biri seçilir, o ilçede listelenen (`isListed`, `isActive`) restoranlar kart olarak gösterilir ve `/<slug>` sayfasına gider. Listeleme süper adminin kararıdır (`docs/PLATFORM_YONETIMI.md`).

## Sipariş verme

`POST /public/qr/:token/orders` ve `POST /public/restaurants/:slug/orders` gövdesi `PublicOrderSchema`: teslim şekli, satırlar (ürün, adet, seçilen seçenekler), iletişim (masa siparişinde isteğe bağlı, diğerlerinde zorunlu), adres (eve teslimde zorunlu), ödeme niyeti (`OrderPaymentIntentSchema`), not ve çevrim içi ödeme için dönüş adresi.

- Şube: masa QR'da masanın şubesi, restoran sayfasında ilk aktif şube (Faz 0 tek şube).
- Kanal: `TABLE_QR` veya `RESTAURANT_SITE`; masaya sipariş yalnızca QR'dan verilebilir.
- Teslimat ücreti: restoranın kuryesi varsa politika sıfır teklif üzerinden uygulanır (`PASS_THROUGH` ücretsiz, `FIXED` sabit, `FREE_ABOVE` eşik); kurye ağı kullanılıyorsa `CourierService.quoteFor()` teklifi politikadan geçer (`docs/KURYE.md`); şube veya adres koordinatsızsa ağ teklif veremez ve politika sıfır teklif üzerinden uygulanır. Ücret siparişte ayrı satırdır, komisyona girmez.
- Ödeme: niyet restoranın kabul ettiği yöntemlere göre çözülür (`docs/YEMEK_KARTI.md`). Çevrim içi yöntemlerde sipariş `PENDING_PAYMENT` açılır ve yanıt `checkoutUrl` taşır; tarayıcı barındırılan ödeme sayfasına gider, ödeme bildirimi siparişi `PLACED` yapar. Kapıda yöntemlerde sipariş hemen `PLACED` olur ve yanıt takip anahtarını döner; sayfa `/t/<token>` adresine geçer.
- Müşteri: telefonu verilen misafir global `User` olarak bulunur veya açılır ve restoranın müşteri listesine girer; mesaj bildirimleri `docs/MESAJLASMA.md` kurallarıyla gider.

## Oran sınırı

Kimliksiz yazma uçları `PublicRateLimitGuard` ile istemci başına sınırlıdır: sipariş `PUBLIC_ORDER_RATE_LIMIT` (varsayılan 10) ve huni adımı `PUBLIC_FUNNEL_RATE_LIMIT` (varsayılan 60), 10 dakikalık pencerede. Sayaç Redis varsa orada (her API örneği aynı pencereyi görür), yoksa süreç belleğindedir. İstemci, Caddy'nin ilettiği ilk `x-forwarded-for` adresi veya soket adresidir. Aşım `RATE_LIMITED` ile reddedilir.

## Henüz yok

Kayıtlı kartla tek dokunuş ödeme. Mobil uygulama Faz 1'dir.

Pazaryeri listesi yalnızca `isActive`, `isListed` ve askıda olmayan (`listingSuspendedAt` boş) restoranları gösterir; vadesi geçmiş komisyon faturası listelemeyi askıya alır, sayfanın kendisi açık kalır (`docs/FATURALAMA.md`).

Listelenme kararı konsolundur: restoran menüsü hazır olunca Ayarlar sayfasından talep eder, konsol onaylar (`docs/PLATFORM_YONETIMI.md`).

## Pazaryeri sıralaması

İlçe listesi (`GET /public/marketplace`) belirli ve açıklanabilir bir sırayla gelir (`packages/shared/src/marketplace-ranking.ts`): önce şu an açık olanlar (şube çalışma saatleri `OpeningHoursSchema`, restoranın saat diliminde `isOpenAt`; saati olmayan restoran gizlenmez, açık sayılır), sonra puan: `(toplam + 4 x 5) / (sayı + 5)` ile öncele çekilmiş ortalama artı son 30 günün tamamlanan sipariş sayısının `0,25 x ln(1 + n)` katkısı, eşitlikte ad. Her kartta "Şu an açık / kapalı" rozeti ve puan görünür. Sıralamada satın alınan bir ağırlık yoktur; ileride öne çıkarma ürünü ayrı ve etiketli bir yuva olur, bu puanın içine girmez.

İlçesi açık olmayan ziyaretçi sayfanın altındaki kutudan il ve ilçesini bırakır (`POST /public/marketplace/interest`, oran sınırlı, kimlik bilgisi alınmaz); ilçe başına bir sayaç tutulur (`marketplace_interest`) ve konsolun lansman araçlarında görünür (`docs/PLATFORM_YONETIMI.md`). İlçe zaten açıksa sayaç artmaz, sayfa ziyaretçiyi listeye yönlendirir.

## Adres geokodlama

Koordinatı olmayan teslimat adresi, kurye ağı teklifi ve sevk rotası için önce koordinata çevrilir (`packages/shared/src/geocoding.ts`, `apps/api/src/modules/geocoding`). Her yerde en iyi çaba ilkesiyle çalışır: sağlayıcı yanıt vermezse veya eşleşme yalnızca ilçe düzeyindeyse (`AREA`) nokta boş kalır ve sipariş eskisi gibi ilerler; müşterinin veya personelin verdiği koordinat hiçbir zaman değiştirilmez.

- Nerede çalışır: vitrin siparişi (`StorefrontService.place`, ücret hesabından önce), personel siparişi (`OrdersService.create`), müşterinin kayıtlı adresi (`POST me/addresses`), restoran kaydında şube adresi (`RestaurantProvisioningService`). Vitrin ve personel siparişinde şube konumu yakınlık ipucu olarak verilir.
- Sağlayıcı `GEOCODER_PROVIDER`: `NONE` (koordinat boş kalır; üretim varsayılanı), `MOCK` (geliştirme ve test; yakınlık ipucuna göre deterministik bir nokta, ipucu yoksa boş; üretimde reddedilir), `NOMINATIM` (OpenStreetMap; `NOMINATIM_BASE_URL` ile kendi kurulumunuz, varsayılan herkese açık örnek). Genel Nominatim politikası gereği istekler saniyede bir ile aralıklanır ve tanıtıcı `User-Agent` gönderilir; yanıtlar bir gün bellekte tutulur. `GOOGLE`: Google Geocoding API (`GOOGLE_MAPS_API_KEY`, sunucu tarafı anahtar; ülke bileşeniyle daraltılır, şube etrafında küçük bir görünüm alanıyla yönlendirilir; `ROOFTOP` ve `RANGE_INTERPOLATED` / `GEOMETRIC_CENTER` rotalanabilir, `APPROXIMATE` alan sayılır).
- Yeni sağlayıcı (Google, HERE, Mapbox, Yandex) `GeocoderAdapter` arkasında bir sınıftır; sipariş akışında kod yolu değildir.

## Değerlendirme

Müşteri, tamamlanan siparişini (`DELIVERED` veya `PICKED_UP`) takip sayfasından bir kez puanlar: 1-5 puan ve isteğe bağlı yorum (`RateOrderSchema`, `packages/shared/src/ratings.ts`). Pencere tamamlanmadan sonra `RATING_WINDOW_DAYS` (7) gündür; takip anlık görüntüsü `canRate` ve varsa `rating` taşır. Uç: `POST /public/orders/:token/rating` (oran sınırlı; tamamlanmamış veya süresi geçmiş sipariş `RATING_NOT_ALLOWED`, ikinci deneme `RATING_EXISTS`). Kayıt `order_ratings` satırıdır ve restoranın `ratingSum` / `ratingCount` toplamını günceller; personel düzenleyemez veya silemez. Restoran puanları raporlar sayfasında (dönemin ortalaması, sayısı ve son 10 yorum) görür; pazaryeri listesinde restoranın ortalaması ve değerlendirme sayısı yazar. Değerlendirme yalnızca işletmeye gider, herkese açık yorum sayfası yoktur.

## Kendi alan adı (Pro)

Restoran, sipariş sayfasını kendi alan adında (örneğin `siparis.restoranim.com`) açabilir; Pro özelliği `custom_domain`. Kod: `apps/api/src/modules/domains` (servis, DNS doğrulayıcı adaptörü `DNS` / `MOCK`, uçlar), `apps/web/src/middleware.ts` (ana sayfa yeniden yazımı), `deploy/caddy/Caddyfile` (isteğe bağlı sertifika), ayarlar kartı `SettingsForm.tsx`.

- Sahip Ayarlar sayfasından alan adını kaydeder (`PUT /restaurants/:id/domain`, `HostnameSchema`; platformun kendi adresi ve alt alanları `DOMAIN_INVALID`, başka restorana kayıtlı ad `DOMAIN_TAKEN`), sağlayıcısında CNAME kaydını platformun web adresine (`PUBLIC_APP_URL` host'u, ekranda gösterilir) yönlendirir ve "Doğrula" der (`POST /restaurants/:id/domain/verify`). Doğrulayıcı CNAME hedefini ya da A kayıtlarının platformunkiyle aynı olmasını arar; başarılıysa `customDomainVerifiedAt` yazılır, son kontrolde görülen kayıtlar ekranda listelenir. Alan adı değişince doğrulama sıfırlanır.
- Sunum koşulu: doğrulanmış, restoran aktif ve plan `custom_domain` taşıyor. Plan düşerse kayıt ve doğrulama korunur, host hizmet vermez.
- `GET /public/domains/resolve?host=` doğrulanmış host'un slug'ını verir (yoksa 404). Web middleware'i platform host'u (`WEB_DOMAIN`, yerelde `localhost`) dışındaki bir host'ta `/` isteğini `/<slug>` sayfasına yeniden yazar; diğer yollar (`/t/<token>`, `/hesabim`, `/giris`) aynı host'ta olduğu gibi çalışır. Çözüm 60 saniye bellekte tutulur.
- Sertifika: Caddy `on_demand_tls` ile ilk ziyarette sertifika alır; önce `GET /public/domains/check?domain=` sorulur ve yalnızca 200 dönen host için istenir, böylece bize ait olmayan bir ad için hiçbir zaman sertifika istenmez. Sunucu tarafında ek bir işlem gerekmez; DNS A kaydı yerine CNAME önerilir.
- Testte `DOMAIN_VERIFIER=MOCK`: `.verified.test` ile biten her host platforma işaret ediyor sayılır.

## Teslimat bölgesi

`delivery_zones` modül anahtarının arkasındadır (`docs/OZELLIK_ANAHTARLARI.md`), varsayılanı kapalıdır. Anahtar kapalıyken teslimat eskisi gibi çalışır: yarıçap ve alt sınır yoktur, ücreti ücret politikası belirler; kayıtlı bölge saklanır ama uygulanmaz.

- **Yarıçap**: şubeden adrese düz çizgi mesafesi (`haversineMeters`). Adresin noktası yoksa önce geokodlanır (yukarıda "Adres geokodlama"); yarıçap dışındaki teslimat `409 DELIVERY_OUT_OF_ZONE` ile reddedilir.
- **En az sepet**: ürünlerin toplamı (teslimat ücreti hariç) alt sınırın altındaysa teslimat `409 MIN_BASKET_NOT_MET` ile reddedilir; menü sayfası alt sınırı gösterir ve sepet yetmediğinde sipariş düğmesini kapatır. Gel al ve masaya sipariş bu kurallara takılmaz.
- **Mesafe bantları**: yalnızca kendi kuryesiyle (`RESTAURANT_COURIER`) teslimatta; adresin düştüğü bandın ücreti alınır (içten dışa, en fazla 8 bant, sonuncusu yarıçapa ulaşır). Ücret politikası `FREE_ABOVE` ise eşiğin üstündeki sepet yine ücretsizdir. Bant yoksa ücret politikası geçerlidir; kurye ağıyla teslimatta ücret her zaman ağın teklifinden gelir.
- **Kural yeri**: `packages/shared/src/delivery-zone.ts` (`DeliveryZoneSchema`, `deliveryZoneRefusal`, `zoneDeliveryFee`); API `DeliveryZoneService`. Personelin girdiği telefon ve kasa siparişleri kurallara takılmaz.
- **Uçlar**: `GET` / `PUT /restaurants/:id/delivery-zone` (`restaurant.settings.view` / `restaurant.settings.manage`, anahtar gerekir; `{ zone: { radiusMeters, minBasketMinor, bands: [{ upToMeters, feeMinor }] } | null }`), her değişiklik denetim kaydına yazılır. Menü yanıtında `ordering.deliveryZone`, anahtar açıkken bölgeyi taşır. Panelde ayarlar sayfasında "Teslimat bölgesi" kartı anahtar açıkken görünür.

## Müşteri hesabı (`/hesabim`)

Telefon numarası hesaptır; masa QR'ından veya restoran sayfasından giriş aynı OTP akışıdır (`/giris?kayit=1&next=...`). Giriş yapmış ziyaretçi için vitrin ad ve telefonu önceden doldurur, eve teslimde kayıtlı adresleri seçtirir (varsayılan adres hazır gelir, koordinatı varsa siparişe geçer) ve yeni adresi isteğe bağlı olarak hesaba kaydeder. `/hesabim`: ad, kayıtlı adresler (ekle, varsayılan yap, sil; liste hiçbir zaman varsayılansız kalmaz), sadakat puanları (restoran başına bakiye ve bugünkü değeri, `docs/SADAKAT.md`), son 50 sipariş ve takip bağlantıları, çıkış. Sadakat programı olan restoranda sepet özeti bakiyeyi, "puan kullan" kutusunu ve bu siparişle kazanılacak puanı gösterir; puan harcayan sipariş `useLoyaltyPoints` ile gider ve sipariş uçları giriş yapmış ziyaretçiyi isteğe bağlı kimlik doğrulamayla tanır.

Uçlar (`me/*`, yalnızca oturum): `GET me/account`, `GET me/viewer?restaurantId=` (vitrin için ad, telefon, adresler ve o restorandaki puan), `PATCH me/profile`, `GET / POST me/addresses`, `PATCH / DELETE me/addresses/:id`, `GET me/orders`; kişisel veri hakları için `GET me/data-export` ve `POST me/account/delete` (`docs/KISISEL_VERI.md`; sayfada "Kişisel verileriniz" kartı). Adresler kullanıcıya aittir; başka kullanıcının adresi 404'tür. Sipariş adres anlık görüntüsü siparişte kalır; kayıtlı adresin sonraki değişikliği geçmiş siparişi değiştirmez.
