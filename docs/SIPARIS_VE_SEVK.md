# Sipariş yaşam döngüsü, sevk ve canlı takip

Bu belge siparişin verilmesinden kapıya teslimine kadar olan veri akışını, restoranın kendi kuryesiyle çalışan sevk (dispatch) yapısını ve müşterinin canlı takip ekranını tanımlar. Model, bu işi ölçekte yapan platformların (Uber Eats, DoorDash) kurduğu akışın kendi kuryesi olan tek restoran ölçeğine uyarlanmış halidir: tek bir durum makinesi, her adımın olay olarak yayınlanması, kuryenin konumunun yalnızca sefer sürerken paylaşılması ve çok duraklı seferlerde sıranın restoran veya rota motoru tarafından belirlenmesi.

Kod: `packages/shared/src/delivery.ts` (durum makinesi, rota, DTO'lar), `apps/api/src/modules/orders` (sipariş), `apps/api/src/modules/dispatch` (sefer, kurye, konum), `apps/api/src/modules/realtime` (SSE), `apps/web/src/app/t/[token]` (müşteri takip sayfası).

## 1. Sipariş durumları

`OrderStatus` yaşam döngüsü durumudur; restoranın yapılandırdığı hiçbir şey enum değildir.

```
PENDING_PAYMENT -> PLACED -> ACCEPTED -> PREPARING -> READY
                                                      |-- eve teslim: HANDED_TO_COURIER -> OUT_FOR_DELIVERY -> ARRIVING -> DELIVERED
                                                      |-- gel al:     PICKED_UP
                                                      '-- masaya:     DELIVERED (servis edildi)
Her adımdan: REJECTED, CANCELLED_BY_CUSTOMER, CANCELLED_BY_RESTAURANT; uçtan: REFUNDED
```

Geçiş tablosu `ORDER_TRANSITIONS` teslimat türüne (`FulfillmentType`) göre ayrıdır ve her geçişi kimin tetikleyebileceğini (`OrderActor`: RESTAURANT, COURIER, CUSTOMER, SYSTEM) taşır. Kurallar:

- Mutfak durumlarını (kabul, hazırlanıyor, hazır, ret, iptal) restoran değiştirir. Kabulde hazırlık süresi verilir; `promisedReadyAt = şimdi + prepMinutes` (varsayılan süre sevk ayarlarından gelir).
- Müşteri yalnızca mutfak işe başlamadan (PLACED, ACCEPTED) iptal edebilir.
- Kurye bacağı (HANDED_TO_COURIER, OUT_FOR_DELIVERY, ARRIVING, DELIVERED) sipariş bir sefere bağlıyken yalnızca sefer uçlarından değişir; sipariş ucundan denenirse `ORDER_IN_TRIP` döner. Sefere hazır olmadan planlanmış (ACCEPTED / PREPARING) bir siparişin READY'ye geçişi ise mutfağın adımıdır ve sipariş ucundan (veya mutfak ekranından) yapılır; yoldan READY'ye dönüş (teslim edilemedi) seferin işidir. Sefere bağlı olmayan bir eve teslim siparişinde restoran bu adımları elle de işleyebilir (uygulama kullanmayan kurye için yedek yol).
- Teslim edilemeyen sipariş `READY` durumuna geri döner (gerekçe geçmişe yazılır); restoran yeni sefere ekler veya iptal eder.
- `REFUNDED` para geri döndüğünde gelir: iade ucu (`POST /:orderId/refund`, `orders.refund`), iptalden hemen sonraki otomatik iade veya sağlayıcının iade bildirimi (`docs/ODEME.md` bölüm 3b). `/transition` ile `REFUNDED` istenirse `REFUND_NOT_ALLOWED` döner.
- Her geçiş `order_status_history` tablosuna aktör ve gerekçeyle yazılır; `acceptedAt`, `readyAt`, `completedAt`, `cancelledAt` sütunları damgalanır.
- Geçiş karşılaştır-ve-değiştir ile yazılır: durum yalnızca okunduğu değerdeyken güncellenir. Aynı siparişe aynı anda gelen iki istekten (iki ekran, mutfak ekranında iki aşçı) yalnızca biri uygulanır, diğeri `409 ORDER_TRANSITION_INVALID` alır. Böylece geçişe bağlı yan etkiler (defter, sadakat, akışlar, kupon iadesi) her gerçek durum değişikliği için bir kez çalışır.

Sipariş oluşturulurken `computeModeSettlement()` anlık görüntüsü, ürün ad ve fiyat anlık görüntüleri (`order_items`, sepet sırası `position`), adres anlık görüntüsü (`AddressSnapshot`, isteğe bağlı koordinat) ve tahmin edilemez bir takip anahtarı (`trackingToken`, 24 rastgele bayt) yazılır. Telefonu bilinen müşteri global `User` olarak bulunur veya açılır ve `restaurant_customers` sayaçları güncellenir. QR oturumu verilmişse `PLACED_ORDER` huni olayı kaydedilir.

Uçlar (`/restaurants/:id/orders`, izinler `orders.view` / `orders.manage`): liste (`?status=`, `?fulfillment=`, `?active=true`), oluşturma, detay, `POST /:orderId/transition { to, reason?, prepMinutes? }`. Müşteri iletişim bilgisi `customers.contact.view` izni olmayan rollere maskeli döner.

## 2. Sefer (DeliveryTrip) ve duraklar

Sefer, restoranın kendi kuryesinin bir çıkışta taşıdığı bir veya daha fazla siparişi gruplar. Kurye, `courier.deliver` iznine sahip bir `Membership`tir (varsayılan `courier` rol şablonu); aynı uygulamayı kullanır, yalnızca kendine atanan seferleri görür.

```
PLANNED -> ASSIGNED -> IN_PROGRESS -> COMPLETED
                 '--------------------> CANCELLED
```

Durak (`DeliveryStop`) durumları: PENDING, EN_ROUTE (kurye bu durağa gidiyor), ARRIVING (varış yarıçapı içinde), DELIVERED, FAILED, REMOVED.

Akış:

1. **Sefer oluşturma** (`POST /restaurants/:id/dispatch/trips`, `dispatch.manage`): READY (veya önceden planlamak için ACCEPTED / PREPARING) durumundaki, aynı şubeye ait, başka aktif sefere bağlı olmayan eve teslim siparişleri seçilir. `maxStopsPerTrip` aşılamaz. Kurye hemen atanabilir (`ASSIGNED`) veya sonra (`PUT /trips/:tripId/courier`).
2. **Durak sırası**: iki mod vardır ve restoran istediği zaman değiştirebilir.
   - `MANUAL`: restoran sırayı belirler (`PUT /trips/:tripId/sequence { stopIds }`; kalan durakların bir permütasyonu olmalıdır).
   - `OPTIMIZED`: rota motoru en kısa açık yolu bulur (`POST /trips/:tripId/optimize`): en yakın komşu, ardından 2-opt iyileştirmesi (`optimizeStopOrder`). Çıkış noktası yola çıkmadan önce şube, yola çıktıktan sonra kuryenin son konumudur. Yola çıktıktan sonra kuryenin o an gittiği durak sabit kalır, yalnızca kalanlar yeniden sıralanır. Koordinatı olmayan adresler rotalanamaz ve listenin sonuna eklenir; ETA verilmez.
3. **Teslim alma** (`POST .../pickup`): kurye paketleri aldığını onaylar; seferdeki her sipariş HANDED_TO_COURIER olur. Hazır olmayan bir sipariş varsa sefer başlamaz (`TRIP_STATE_INVALID`).
4. **Yola çıkma** (`POST .../start`): teslim alma atlanmışsa önce yapılır; tüm siparişler OUT_FOR_DELIVERY, ilk durak EN_ROUTE, sefer IN_PROGRESS. Her durak için tahmini varış hesaplanır.
5. **Varış** (`POST .../stops/:stopId/arrive` veya otomatik): durak ARRIVING, sipariş ARRIVING; müşteri "kapıda olun" mesajını görür.
6. **Teslim** (`POST .../stops/:stopId/deliver`): durak ve sipariş DELIVERED, sıradaki PENDING durak EN_ROUTE olur. **Teslim edilemedi** (`POST .../stops/:stopId/fail { reason }`): durak FAILED, sipariş READY'ye döner, sefer sıradakiyle sürer. Teslimat kodu modülü açıkken kurye teslimde müşterinin kodunu girer (`docs/TESLIMAT_KODU.md`).
7. Son durak kapanınca sefer COMPLETED olur, kuryenin konum kaydındaki sefer bağı kaldırılır.
8. **İptal** (`POST .../cancel`): kalan duraklar REMOVED, kuryedeki siparişler READY'ye döner; teslim edilmiş olanlar değişmez.

Kurye uçları `/restaurants/:id/courier/me/*` altındadır (`courier.deliver`): seferlerim, sefer detayı, pickup / start / arrive / deliver / fail, konum. Kurye yalnızca kendine atanan sefer üzerinde işlem yapabilir (`COURIER_NOT_ASSIGNED`). `dispatch.manage` iznine sahip personel aynı adımları sefer uçlarından kurye adına işleyebilir.

Sevk panosu (`GET /restaurants/:id/dispatch/board`, `dispatch.view`) tek yanıtta döner: sevk bekleyen hazır siparişler, mutfaktaki eve teslim siparişleri, aktif seferler (durak ve kurye konumlarıyla), kuryeler (son konum, aktif sefer) ve sevk ayarları.

Panelde (`/panel/<slug>/sevk`) aktif seferin bekleyen durakları sürüklenip başka bir durağın üzerine bırakılarak sıralanır: sürüklenen durak bırakıldığı yerin sırasını alır, diğerleri göreli sırasını korur (`reorderStopIds`) ve yeni sıra `PUT .../trips/:id/sequence` ile gönderilir. Yukarı / aşağı düğmeleri klavye kullanımı için kalır.

## 3. Konum akışı

- Kurye uygulaması konumunu küçük partiler halinde gönderir (`POST /restaurants/:id/courier/me/location { points[] }`, en fazla 60 nokta). Kısa çevrimdışı aralıklar kaybolmaz, geciken noktalar sırayla işlenir.
- Konum yalnızca kuryenin aktif bir seferi (ASSIGNED veya IN_PROGRESS) varken kabul edilir; yoksa `tracked: false` döner ve hiçbir şey saklanmaz. Kuryenin mesai dışı konumu platforma girmez.
- Son konum `courier_locations` tablosunda üyelik başına tek satırdır (üzerine yazılır). Seferin izi `courier_location_samples` tablosuna seyreltilerek (en az 20 m veya 15 sn) eklenir; itiraz ve tekrar oynatma içindir.
- IN_PROGRESS seferde her partide: kalan durakların mesafe ve ETA'sı kuryenin konumundan yeniden hesaplanır (`estimateStopEtas`, durak başına teslim süresi eklenir) ve `orders.estimatedDeliveryAt` güncellenir; kurye EN_ROUTE durağın `arrivalRadiusMeters` yarıçapına girince durak kendiliğinden ARRIVING olur (geofence); sevk panosuna `courier.location`, yoldaki her müşteriye kendi `tracking.updated` olayı yayınlanır. Yayın sıklığı sefer başına `locationBroadcastSeconds` ile sınırlanır.

ETA, `ROUTING_PROVIDER` ile seçilen sağlayıcıdan gelir ve sipariş akışında kod yolu açılmaz: `HAVERSINE` (varsayılan) düz çizgi mesafesi x sapma katsayısı / ortalama hız; `OSRM` (`apps/api/src/modules/dispatch/osrm.routing.ts`) bir OSRM sunucusunun `route` servisinden yol mesafesi ve süresi alır, en kısa rota için `table` servisinin mesafe matrisini kullanır (`optimizeStopOrder()` matris verilince düz çizgi yerine onu kullanır). OSRM yanıt vermezse (ağ, zaman aşımı, `Ok` dışı kod) aynı çağrı düz çizgi tahminine düşer ve günlüğe yazılır; sevk hiçbir zaman harita motoruna takılmaz. `OSRM_BASE_URL` verilmezse herkese açık demo sunucusu kullanılır (yalnızca geliştirme); üretim kendi OSRM'ini ya da barındırılan bir OSRM'i gösterir. Mapbox veya Google gibi başka motorlar aynı `RoutingProviderAdapter` arayüzüyle eklenir.

## 4. Sevk ayarları

`Restaurant.dispatchSettings` (JSON, `DispatchSettingsSchema`), restoran verisidir; eksik alanlar varsayılanla tamamlanır:

| Alan | Varsayılan | Anlam |
|---|---|---|
| `avgSpeedKmh` | 22 | ETA için ortalama kapıdan kapıya kurye hızı |
| `detourFactor` | 1,35 | Düz çizgi / yol mesafesi katsayısı (HAVERSINE) |
| `stopServiceMinutes` | 3 | Durak başına teslim süresi |
| `arrivalRadiusMeters` | 150 | Otomatik ARRIVING yarıçapı |
| `maxStopsPerTrip` | 6 | Sefer başına en fazla durak |
| `locationBroadcastSeconds` | 4 | Konum yayın aralığı |
| `defaultPrepMinutes` | 20 | Kabulde önerilen hazırlık süresi |
| `acceptTimeoutMinutes` | 10 | Yeni siparişin kabul için bekleyebileceği süre; sonrasında ekran alarm verir ve sahibe mesaj gider |

## 5. Canlı akış (SSE)

Tek yönlü akış için Server-Sent Events kullanılır (`RealtimeService`): Caddy üzerinden ek altyapı gerektirmez, tarayıcıda `EventSource`, mobilde akışlı `fetch` ile çalışır. Çok örnekli çalışmada olaylar Redis pub/sub kanalıyla tüm API örneklerine dağıtılır. Her konu kısa bir tekrar tamponu tutar; `Last-Event-ID` ile yeniden bağlanan istemci kaçırdıklarını alır. Her olay varlığın tam halini taşır; bu yüzden olay kaçıran istemci bir sonraki olayla doğru duruma gelir. 25 saniyede bir kalp atışı gönderilir.

| Uç | Kitle | Olaylar |
|---|---|---|
| `GET /restaurants/:id/dispatch/events` (`dispatch.view`) | sevk panosu ve sipariş ekranı | `order.updated`, `trip.updated`, `courier.location` |
| `GET /restaurants/:id/courier/me/events` (`courier.deliver`) | kurye uygulaması | `trip.updated`, `order.updated` (kendi seferleri) |
| `GET /public/orders/:token/events` | müşteri | önce anlık görüntü, sonra `tracking.updated` |

Web'de akış BFF üzerinden geçer (`/api/bff/...`); BFF gövdeyi tamponlamadan aktarır. Mobil istemci `Authorization` başlığıyla doğrudan API'ye bağlanır.

## 6. Müşteri takip sayfası

`https://<web>/t/<token>`: sunucuda `GET /public/orders/:token` ile çizilir, ardından `TrackingLive` bileşeni olay akışına bağlanır. Gösterilenler: adım çizelgesi (teslimat türüne göre), durum metni, söz verilen hazır olma / tahmini teslim saati, kurye bloğu (yalnızca kuryede veya yoldayken): kuryenin adı (yalnızca ad), uzaklık, önünde kaç teslimat olduğu ("kuryeniz önce yakındaki N teslimatı tamamlayacak"), harita (kurye ve teslimat noktası; yalnızca kurye yoldayken) ve haritada aç bağlantısı, sipariş içeriği, işletmeyi ara. Başka müşterinin adresi veya kimliği hiçbir zaman yer almaz; kurye konumu yalnızca sefer IN_PROGRESS iken verilir.

### Harita

Takip sayfası ve sevk panosu aynı bileşeni kullanır (`apps/web/src/components/MapView.tsx`, Leaflet; yalnızca tarayıcıda yüklenir). Döşeme (tile) sağlayıcısı dağıtım ayarıdır: web sunucusu `MAP_TILE_URL`, `MAP_ATTRIBUTION` ve `MAP_MAX_ZOOM` değerlerini istek anında okur ve bileşene prop olarak geçirir; imaja hiçbir şey gömülmez, sağlayıcı değiştirmek `.env` değişikliğidir. Varsayılan OpenStreetMap'in herkese açık döşemeleridir (geliştirme ve küçük dağıtımlar için; kullanım politikası geçerlidir), üretim ücretli bir sağlayıcıya yönlendirilir. İşaretler daire olarak çizilir ve renklerini kitin rollerinden alır (`globals.css`: kurye tema rengi, teslimat noktası başarı, sıradaki durak gri, aktif durak uyarı, biten durak çizgi rengi). Sevk panosundaki harita konum paylaşan kuryeleri ve aktif seferlerin koordinatlı duraklarını gösterir ve SSE olaylarıyla yeniden çizilir; takip sayfasındaki harita yalnızca o siparişin kuryesini ve kapısını gösterir.

## 6b. Sipariş alma durumu

İşletme müşteri siparişlerini geçici olarak durdurabilir, yoğun olduğunu bildirebilir ve çalışma saatleri dışında sipariş almayabilir. Bu davranış `order_availability` modül anahtarının arkasındadır (`docs/OZELLIK_ANAHTARLARI.md`), varsayılanı kapalıdır; anahtar kapalıyken her işletme eskisi gibi her an sipariş alır.

- **Duraklatma**: sipariş ekranındaki "Sipariş alma" kartından 15, 30, 60 veya 120 dakika ya da "ben açana kadar". "Ben açana kadar" da en fazla bir gün sürer (`AVAILABILITY_MAX_MINUTES`); unutulan duraklatma işletmeyi kalıcı olarak gizlemez. Süre bitince sipariş alma kendiliğinden açılır. Alan: `restaurants.ordersPausedUntil`.
- **Yoğun mod**: bir saat boyunca hazırlık süresine 10, 20, 30 veya 45 dakika eklenir; müşteri menü sayfasında "hazırlık yaklaşık N dk sürebilir" uyarısını görür. Sipariş reddedilmez. Alanlar: `busyExtraMinutes`, `busyUntil`.
- **Çalışma saatleri**: ayarlar sayfasındaki editörle şube başına haftalık aralıklar (gün başına en fazla dört; gece yarısını geçen aralık kapanışı açılıştan küçük yazılarak girilir). Aynı saatler pazaryerindeki "şu an açık" bilgisini besler, bu yüzden anahtar kapalıyken de düzenlenebilir. Saat girilmemiş işletme hiçbir zaman kapalı sayılmaz.
- **Kural** (`orderAvailability()`, `packages/shared/src/availability.ts`): önce duraklatma, sonra siparişin şubesinin saatleri. Masa QR'dan ve restoran sayfasından gelen sipariş durdurulmuşsa veya saat dışındaysa `409 RESTAURANT_NOT_ACCEPTING` ile reddedilir; menü yanıtındaki `availability` alanı durumu, duraklatmanın bitişini ve bir sonraki açılışı (işletmenin saat diliminde gösterilir) taşır, sayfa sipariş düğmesini kapatır. Personelin girdiği telefon ve kasa siparişleri hiçbir durumda reddedilmez: kararı tezgahtaki kişi verir.
- **Pazaryeri**: anahtar açıkken duraklatılmış işletme "kapalı" görünür ve sıralamada açık olanların arkasına düşer.
- **Uçlar**: `GET /restaurants/:id/availability` (`orders.view`; anahtar kapalıyken `enabled: false` döner ve kart görünmez), `PUT /restaurants/:id/availability` (`orders.manage`, anahtar gerekir; `{ pause: { minutes | null } | null, busy: { extraMinutes, minutes } | null }`, her değişiklik denetim kaydına yazılır), `GET` / `PUT /restaurants/:id/opening-hours` (`restaurant.settings.view` / `restaurant.settings.manage`).

İleri tarihli sipariş (`scheduled_orders`, `docs/ILERI_TARIHLI_SIPARIS.md`) açıkken müşteri saat dışında da çalışma saatleri içinden sunulan bir saat için ön sipariş verebilir; kabul alarmı o siparişin hazırlığa başlama zamanına göre konur.

Bir sonraki açılış zamanı yerel dakikalarla hesaplanır; arada yaz saati değişimi varsa gösterilen saat bir saat kayabilir. Bu değer yalnızca gösterilir, kural her istekte yeniden değerlendirilir.

## 7. Mobil uygulama sözleşmesi (Faz 1, Expo)

Tek uygulama; rol üyelikten gelir.

- **Kurye modu** (`courier.deliver`): `GET courier/me/trips` ve `courier/me/events` ile sefer listesi; sefer ekranında sıralı duraklar, her durak için adres, telefon, mesafe ve ETA; büyük tek aksiyon düğmesi (Teslim aldım -> Yola çık -> Vardım -> Teslim ettim / Teslim edilemedi); sefer haritası (teslim alma noktası olarak şube koordinatı `pickupPoint`, numaralı duraklar, kuryenin konumu, kalan duraklardan düz çizgi) ve yol tarifi için telefonun seçilen harita uygulaması (`docs/MOBIL.md`, "Kurye haritası"); arka plan konum servisi sefer sürerken 3-5 saniyede bir nokta toplar ve partiler halinde `courier/me/location` ucuna gönderir; uygulama kapanınca konum gönderimi durur (platform da aktif sefer yoksa reddeder).
- **Müşteri modu**: aynı takip DTO'su (`OrderTrackingDTO`); uygulama anlık görüntüyü yeniler ve web takip sayfasıyla aynı kuralla haritayı gösterir (kurye ve kapı; `docs/MOBIL.md`, "Haritalar").
- **Restoran modu** (tablet): sevk panosu, sürükleyerek sıralama, "en kısa rotayı bul", kurye atama; kuryeler ve aktif seferlerin durakları haritada.

Harita döşeme sağlayıcısı (ücret, lisans, Türkiye kapsama) sahibin kararıdır ve dağıtım ayarıyla seçilir (yukarıda "Harita"); kod koordinat üretir ve verilen döşemeleri çizer.

## 8. Üçüncü taraf kuryeyle ilişki

Kurye ağına verilen siparişlerde hareket `DeliveryRequest` ve `CourierProviderAdapter` webhook'larından gelir (`docs/KURYE.md`, "Kurye çağırma"; personel sipariş kartından çağırır, `POST /webhooks/courier/<kod>` imza doğrulanarak işlenir). Bu olaylar aynı sipariş durum makinesine bağlanır (`networkOrderSteps()`: ASSIGNED -> HANDED_TO_COURIER, PICKED_UP -> OUT_FOR_DELIVERY, DELIVERED -> DELIVERED, iptal ve başarısızlıkta kurye bacağından READY'ye dönüş). Müşteri takip sayfası her iki modda aynıdır; ağ siparişinde kurye kartı yerine ağın adı ve takip bağlantısı gösterilir.

## 9. Sonraki adımlar

- Herkese açık uçlara (takip, menü) Redis tabanlı oran sınırı.
- Kabul zaman aşımı tamamlandı: `PLACED` sipariş `acceptDeadlineAt` (yerleştirme + `acceptTimeoutMinutes`) taşır; önce ödenen sipariş pencereye ödeme düşünce girer, kabulde alan temizlenir. `OrdersWatchdog` dakikada bir süresi geçen ve henüz alarm vermemiş siparişleri damgalar (`acceptAlertSentAt`, bir kez), sipariş olayını yeniden yayınlar (kart kırmızıya döner, ekran sesli uyarı verir; ses tercihi tarayıcıda saklanır) ve sahibe `order.acceptOverdue` mesajını platform hesabından gönderir (kredi düşmez). Sipariş restoran adına reddedilmez; karar insana kalır. `ORDER_WATCHDOG=off` ile kapanır. Bildirimler (A7) sipariş olaylarına bağlıdır.
- Teslim kanıtı (fotoğraf, PIN) ve kapıda ödeme tahsilat onayı durak kapanışına eklenir.
- Gerçek yol motoru adaptörü ve trafik duyarlı ETA.
