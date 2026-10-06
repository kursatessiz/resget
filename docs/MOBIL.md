# Mobil Uygulama

`apps/mobile`, Expo SDK 57 ve expo-router ile yazılmış tek uygulamadır. Kurye, resepsiyon, sahip ve ileride müşteri aynı uygulamayı kullanır; hangi ekranların görüneceğine kullanıcının seçili işletmedeki üyeliği ve etkin izinleri karar verir. Bu belge ilk sürümün (B1 kısım 1 ve 2) kapsamını, mimarisini ve çalıştırma yolunu anlatır. Kurye akışının API sözleşmesi `docs/SIPARIS_VE_SEVK.md` bölüm 7'dedir.

## 1. Kapsam

İlk sürümde olanlar:

- Telefon + tek kullanımlık kod ile giriş (`POST /auth/otp/request`, `POST /auth/otp/verify`), web ile aynı akış.
- Üyelikler arası işletme değiştirici; son seçilen işletme cihazda saklanır ve uygulama orada açılır.
- Kurye modu (`courier.deliver` izni): atanmış seferler, sefer ekranında tek "sıradaki adım" düğmesi (teslim al, yola çık, vardım, teslim ettim), teslim edilemedi ve sebebi, müşteriyi arama, durak başına mesafe ve tahmini varış, uygulama içi sefer haritası ve seçilen navigasyon uygulamasına yol tarifi (aşağıda "Kurye haritası").
- Arka plan konum paylaşımı: sefer `IN_PROGRESS` olduğu sürece konum görevi çalışır, ekran kapalıyken de toplar; noktalar seyreltilir ve partiler halinde `POST /restaurants/:id/courier/me/location` adresine gider.
- Sipariş listesi (`orders.view` izni): salt okunur, 15 saniyede bir yenilenir. Mutfak akışı web panelinde kalır.
- Sevk panosu (`dispatch.view` izni; `sevk` sekmesi): sevk bekleyen siparişler, kuryeler (boşta olanlar önce, son konum saati) ve aktif seferler (durum, kurye, sıra modu, duraklar ve tahmini varış). `dispatch.manage` iznine sahip kişi siparişleri dokunma sırasıyla seçer, isterse kurye seçer ve en kısa rotayla sefer oluşturur; seferde kurye atar veya değiştirir, rotayı yeniden hesaplatır ve seferi iptal eder (yalnızca hâlâ yapılabilecek düğmeler görünür, `tripActions()`). Genişlik 768 pikselden büyükse iki panel yan yana (tablet), değilse alt alta (telefon). Pano 8 saniyede bir yeniden okunur; başka cihazda sefere alınan sipariş seçimden düşer.
- Müşteri modu (herkes için): telefon numarasıyla verilen siparişler (`GET /me/orders`), uygulama içi canlı takip (`/t/<token>`: adım merdiveni, durum cümlesi, kurye mesafesi ve tahmini varış, harita bağlantısı, sipariş içeriği, işletmeyi arama, 1-5 puan ve yorum, eksik ürün bildirimi ve sonucu), tekrar sipariş (işletmenin sipariş sayfası tarayıcıda açılır). Teslim edilen teslimat siparişinde takip ekranı kurye bahşişi kartını gösterir (`docs/BAHSIS.md`; ödeme tarayıcıda hosted sayfada, dönüşte ekran yeniden okunur). Kurye ekranında, modül açıksa kuryenin kendi "Bahşişlerim" özeti yer alır (`GET /restaurants/:id/tips/me`). Puanı olan müşteri ekranın başında "Puanlarım" kartını görür: restoran başına bakiye, bugünkü değeri ve sipariş bağlantısı (`GET /me/account` içindeki `loyalty`, web hesap sayfasıyla aynı veri ve metinler, `docs/SADAKAT.md`); puanı olmayana kart gösterilmez.
- Takip bağlantısı derin bağlantıdır: SMS veya WhatsApp ile gelen `https://<web>/t/<token>` ve `resget://t/<token>` doğrudan takip ekranını açar; giriş gerekmez, token yeterlidir.
- Push bildirimleri (`expo-notifications`): girişten sonra cihaz jetonu `POST /me/devices` ile kaydedilir, çıkışta silinir; müşteri sipariş güncellemeleri, kuryeye sefer ataması ve personele yeni sipariş uyarısı aynı telefona rolüne göre gelir (`docs/MESAJLASMA.md`, push bölümü). Bildirime dokunmak ilgili ekranı açar (takip, sefer, siparişler); tanınmayan veri yok sayılır.
- Hesap: kim giriş yapmış, işletme değiştirici, çıkış ve hesabı kalıcı olarak silme (mağaza kuralı; sistem onay penceresiyle, `docs/KISISEL_VERI.md`).

Henüz olmayanlar: mağaza hesaplarıyla EAS derleme ve yayın. Masa QR'ı (`/m/<token>`) bilerek web'de kalır: sipariş vermek uygulama kurulumu gerektirmez. Bunlar `HANDOVER.md` B1 maddesinde kalan iş olarak listelenir.

## 2. Dizin yapısı

```
apps/mobile/
  app/                     expo-router rotaları (dosya adı rota adıdır)
    _layout.tsx            SafeArea + SessionProvider + Stack
    index.tsx              oturum hazır olunca giriş ya da ilk sekmeye yönlendirme
    giris.tsx              telefon + kod
    (app)/_layout.tsx      sekmeler; görünürlük izinlerden (tabsFor)
    (app)/kurye/index.tsx  seferlerim
    (app)/kurye/[tripId]   sefer adımları ve duraklar
    (app)/sevk.tsx         sevk panosu (tablette iki panel)
    (app)/siparisler.tsx   sipariş listesi (personel)
    (app)/siparislerim.tsx kendi siparişlerim (müşteri)
    (app)/hesap.tsx        hesap ve işletme değiştirici
    t/[token].tsx          herkese açık canlı takip; derin bağlantı hedefi
  src/
    lib/api.ts             ApiClient: bearer, 401'de tek yenileme, x-restaurant-id
    lib/session.ts         expo-secure-store ile jeton ve son işletme
    lib/tabs.ts            tabsFor, pickMembership
    lib/dispatch.ts        sevk panosu kuralları: seçim, sefer aksiyonları, kurye sırası, tablet eşiği
    lib/maps.ts            harita modelleri: bölge, haritanın açık olup olmadığı, müşteri takibi ve sevk panosu işaretleri
    lib/trip-map.ts        kurye haritası modeli (işaretler, çizgi, bölge), navigasyon bağlantıları
    lib/use-navigation-app.ts  seçilen navigasyon uygulaması (cihaz tercihi)
    components/map-panel.tsx   react-native-maps ile ortak harita (işaretler, kesikli çizgi, tümünü göster)
    components/trip-map.tsx    sefer haritası (MapPanel üstünde)
    lib/location-batch.ts  LocationQueue: seyreltme, doğruluk filtresi, kuyruk sınırı, parti
    lib/location-tracker.ts expo-task-manager görevi, başlat / durdur / gönder
    lib/i18n.ts            cihaz dili, paylaşılan çevirmen
    lib/push.ts            izin, Expo jetonu, kayıt / silme, dokunma yönlendirmesi
    components/push-bridge.tsx  girişten sonra kayıt ve dokunma dinleyicisi
    lib/config.ts          EXPO_PUBLIC_API_URL, EXPO_PUBLIC_WEB_URL, sürüm
    state/session.tsx      SessionProvider / useSession
    components/ui.tsx      Screen, Title, Body, Caption, Card, Button, Field, Notice
    theme.ts               paylaşılan token'lardan tema
  locales/                 iOS izin metinlerinin çevirileri (app.json locales)
  app.config.ts            app.json üstüne dağıtıma bağlı ayarlar: web alan adı için evrensel bağlantı kaydı, Android harita anahtarı
```

## 3. Mimari kararlar

- **İş mantığı yok.** Uygulama API'nin DTO'larını (`@resget/shared`) gösterir ve API uçlarını çağırır. Durum geçişleri, hakediş, izin kontrolü API'dedir; uygulama yalnızca sıradaki adımı seçer (`nextAction`).
- **Doğrudan API, BFF yok.** Web'deki httpOnly çerez modeli tarayıcı içindir. Mobilde erişim ve yenileme jetonları cihazın anahtarlığında ya da keystore'unda tutulur (`expo-secure-store`); `ApiClient` her isteğe bearer ekler, 401 alınca bir kez `POST /auth/refresh` dener, o da reddedilirse oturumu kapatır ve giriş ekranına döner. Aynı anda gelen isteklerde tek yenileme çalışır.
- **Kiracı kapsamı başlıkla.** `restaurantId` verilen istekler `x-restaurant-id` başlığını taşır; yollar zaten `/restaurants/:id/...` biçimindedir.
- **Sekmeler izinlerden.** `tabsFor(permissions)` yalnızca `courier.deliver` ve `orders.view` izinlerine bakar; "Siparişlerim" (müşteri) ve hesap sekmeleri her zaman vardır, çünkü her kullanıcı aynı zamanda müşteridir. Yeni bir rol ekranı eklemek yeni bir izin eşlemesidir, rol adı kontrolü değildir.
- **Konum yalnızca seferde.** Görev, listede `IN_PROGRESS` sefer varken başlar ve kalmayınca durur; API zaten aktif seferi olmayan kuryenin noktalarını saklamaz (`tracked: false`). `LocationQueue` 3 saniyeden sık noktaları atar, 100 metreden kötü doğruluğu göndermez, çevrim dışında en fazla 600 nokta tutar (en eskiler düşer) ve API sınırı olan 60'lık partiler halinde gönderir; parti yalnızca API kabul edince unutulur, böylece bağlantı kopukluğu sonrası iz tekrar oynatılır.
- **Takip anlık görüntüsü paylaşılan kurallarla.** Adım merdiveni, durum cümlesi anahtarı ve bitiş durumları `packages/shared/src/tracking-steps.ts` içindedir; web takip sayfası ve uygulama aynı fonksiyonları kullanır. Uygulama SSE yerine herkese açık anlık görüntüyü 10 saniyede bir yeniden okur (React Native'de yerleşik `EventSource` yoktur); sipariş bitince durur. Takip bağlantısından token `trackingTokenFromLink()` ile süzülür; biçime uymayan değer ekran açmaz.
- **Tasarım token'ları paylaşılan paketten.** `theme.ts` renkleri `semanticColors` ve `PERFECT_UI_TOKENS` içinden, boşluk ve köşeleri `spacing` / `radii` içinden alır; uygulamada başka renk veya köşe tanımı yoktur. Açık / koyu mod cihazı izler.
- **i18n.** Metinler `packages/shared/src/i18n/messages/{tr,en}/mobile.ts` içindedir (`mobile.*`); sipariş ve hata metinleri web ile aynı anahtarları kullanır (`orders.*`, `errors.*`). Dil cihazdan gelir (`expo-localization`), paket yoksa temel dil kullanılır. Arka plan servisi bildirimi de çevirmenden geçer; iOS izin metinleri `locales/*.json` ile çevrilir.
- **Push jetonu kişiye aittir.** Aynı cihaz başka bir hesapla giriş yaparsa jeton yeni hesaba geçer; çıkışta silinir. Expo Go'da push sınırlıdır (Android'de çalışmaz); gerçek davranış geliştirme veya EAS derlemesiyle görülür ve `app.json` içindeki `extra.eas.projectId` gerektirir.
- **Gizli bilgi yok.** Pakete yalnızca `EXPO_PUBLIC_API_URL` ve `EXPO_PUBLIC_APP_VERSION` girer. İmza ya da sağlayıcı bilgisi uygulamada bulunmaz. Tek istisna Android harita anahtarıdır: Google bu anahtarı uygulamanın manifestinde ister, bu yüzden derlenmiş pakette görünür; depoya yazılmaz, EAS ortamından gelir ve Google Cloud'da paket adı ile imza parmak izine kısıtlanır (aşağıda "Harita sağlayıcısı").

## 3a. Haritalar

Uygulamadaki bütün haritalar tek bileşenden çizilir (`components/map-panel.tsx`, `react-native-maps`, MIT lisanslı; sürüm Expo SDK'nın önerdiğidir). Hangi işaretin görüneceğine saf ve testli fonksiyonlar karar verir (`lib/maps.ts`, `lib/trip-map.ts`); renkler kitin rollerinden gelir. Bölge bir kez ayarlanır: yenilemeler işaretleri taşır ama kişinin kaydırdığı görünümü değiştirmez, "Tümünü göster" bütün noktaları geri getirir. Haritanın açılıp açılmayacağı her ekranda aynı kuraldır (`inAppMapAvailable()`; aşağıda "Harita sağlayıcısı").

- **Müşteri takibi** (`t/[token]`, `trackingMapModel()`): web takip sayfasıyla aynı kural. Kurye konumu biliniyorsa kurye, sipariş yoldayken ve kurye varken kapı. Başka hiçbir müşterinin bilgisi yoktur; "Haritada aç" bağlantısı da durur.
- **Sevk panosu** (`sevk`, `dispatchMapModel()`): web panosu gibi, konum paylaşan kuryeler (adının baş harfiyle) ve aktif seferlerin koordinatlı durakları (sıra numarasıyla; bekleyen, yolda / varıldı, bitti). Tablette sağ panelde seferlerin üstünde, telefonda listeler arasında durur; gösterilecek nokta yoksa bunu söyleyen bir satır çıkar.

### Kurye haritası

Sefer ekranında, aksiyon düğmesinin altında sefer haritası durur (`components/trip-map.tsx`). Model saf fonksiyondur (`lib/trip-map.ts`, `tripMapModel()`) ve testlidir:

- Teslim alma noktası: şubenin koordinatı (`DeliveryTripDTO.pickupPoint`; şubede koordinat yoksa çizilmez).
- Duraklar sıra numarasıyla; renk duruma göre kitin rollerinden gelir: sıradaki durak tema rengi, sonraki duraklar tema çerçeveli yüzey, teslim edilen başarı, teslim edilemeyen hata rengi. Koordinatı olmayan durak haritada yoktur, listede "haritada açılamaz" yazar.
- Kuryenin kendi konumu cihazın yerleşik konum noktasıyla gösterilir (yalnızca sefer atanmış veya yoldayken).
- Kesikli çizgi, henüz gidilmemiş durakları gidilecek sırayla birleştirir: yoldayken kuryenin API'ye son gönderdiği konumdan, öncesinde teslim alma noktasından başlar. Çizgi düz çizgidir, yol değildir; sefer bitince çizgi ve konum kalkar.
- "Tüm seferi göster" haritayı bütün noktaları içine alan bölgeye geri getirir.

Navigasyon (sesli, adım adım yol tarifi) bilerek uygulamaya gömülmez: duraktaki "Yol tarifi" düğmesi seçilen uygulamayı açar (`navigationUrl()`). Seçenekler iOS'ta Apple Haritalar, Google Haritalar, Yandex Haritalar; Android'de Google Haritalar ve Yandex Haritalar. Varsayılan cihazın kendi harita uygulamasıdır, tercih Hesap sekmesinden değiştirilir ve cihazda saklanır (yalnızca `courier.deliver` izni olanlara görünür). Bağlantıların hepsi https evrensel bağlantıdır: uygulama yüklüyse uygulama, değilse web sayfası açılır; URL şeması tanımlamak veya yoklamak gerekmez.

### Harita sağlayıcısı

iOS'ta Apple Haritalar anahtarsız çalışır. Android'de Google Maps SDK kullanılır ve anahtar gerekir: `GOOGLE_MAPS_ANDROID_API_KEY` EAS ortam değişkeni olarak tanımlanır (`eas env:create --name GOOGLE_MAPS_ANDROID_API_KEY --environment production --visibility sensitive`), `app.config.ts` onu `react-native-maps` eklentisine verir. Anahtar Google Cloud'da "Maps SDK for Android" ile sınırlandırılır ve "Android uygulamaları" kısıtıyla `com.resget.app` paket adına ve imza anahtarının SHA-1 parmak izine bağlanır. Anahtar verilmeden yapılan Android derlemesinde bütün haritalar gizlenir (`extra.androidMapsKeyConfigured`); listeler, yol tarifi ve "Haritada aç" düğmeleri çalışmaya devam eder, böylece anahtarsız bir derleme boş harita göstermez. Expo Go haritayı kendi anahtarıyla gösterir, geliştirmede ayrıca bir şey gerekmez. Google Maps SDK mobil harita gösterimi için ücretsiz kotadadır; kota ve fiyat Google'ın güncel tarifesine tabidir.

## 3b. Sipariş yönetimi (tablet ve telefon)

`app_order_handling` modül anahtarı (varsayılan kapalı) ve `orders.manage` izni olan personel için Siparişler sekmesi etkileşimlidir; aksi halde liste salt okunurdur ve panel önerilir.

- **Eylemler**: web sipariş ekranıyla aynı tablo (`orderActionsFor`, `packages/shared/src/order-actions.ts`): kabul (hazırlık süresi seçilir, `ORDER_PREP_OPTIONS`), ret ve iptal (müşteriye gösterilen gerekçe zorunlu), hazırlanıyor, hazır, gel al / masaya servis / yolda / teslim. Durum makinesi API'dedir; uygulama yalnızca izin verilen geçişi ister. Sefere bağlı sipariş sevk panosundan veya kuryeden ilerler.
- **Yeni sipariş uyarısı**: liste 8 saniyede bir yenilenir; ilk yükleme mevcut siparişleri öğrenir, sonraki yüklemelerde yeni gelen her `PLACED` sipariş için cihaz titrer ve yerel bildirim (sesli) çıkar (`freshPlacedOrderIds`). Ek yerel bağımlılık yoktur (`expo-notifications`, React Native `Vibration`). Kabul süresi geçen siparişte kırmızı uyarı görünür; sunucu tarafındaki zaman aşımı alarmı (`docs/SIPARIS_VE_SEVK.md`) aynen çalışır.
- **Kurye çağırma**: `dispatch.manage` izni olan personel, restoranın kurye ağı varsa teslimat siparişinin kartından kurye çağırır ve paket alınmadan önce çağrıyı iptal eder. İsteğin durumu kartta görünür. Kurallar web sipariş kartıyla aynıdır (`courierCallActions`, `docs/KURYE.md` "Kurye çağırma").
- **Tablet**: tablet genişliğinde iki sütun (yeni / mutfakta ve hazır); telefonda tek liste, yeniler üstte.

## 4. Çalıştırma

```
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@resget/shared
EXPO_PUBLIC_API_URL=http://<bilgisayar-ip>:4000 EXPO_PUBLIC_WEB_URL=http://<bilgisayar-ip>:3000 pnpm --filter @resget/mobile start
```

Üretim derlemesinde `EXPO_PUBLIC_WEB_URL` https alan adıdır; `app.config.ts` bu alan adını iOS `associatedDomains` ve Android `intentFilters` olarak kaydeder, böylece `/t/<token>` bağlantıları uygulamada açılır. Web tarafı karşılığını `apps/web/src/lib/app-links.ts` üretir: `/.well-known/apple-app-site-association` (`IOS_APP_IDENTIFIER`, `TEAMID.bundle`) ve `/.well-known/assetlinks.json` (`ANDROID_PACKAGE_NAME`, `ANDROID_CERT_FINGERPRINTS`; SHA-256, virgülle ayrılmış). Değerler web sunucusunun ortamından istek anında okunur; boşken dosyalar 404 döner ve bağlantılar tarayıcıda açılır. Kimlikler mağaza hesapları açılınca `.env` dosyasına yazılır, imaj değişmez.

### EAS derleme profilleri

`apps/mobile/eas.json` üç profil tanımlar: `development` (geliştirme istemcisi, iç dağıtım, yerel API ve web adresleri), `preview` (iç dağıtım, Android APK; `preview` EAS ortamının değişkenleri) ve `production` (sürüm numarası EAS'ta otomatik artar; `production` EAS ortamının değişkenleri). Üretim ve ön izleme için `EXPO_PUBLIC_API_URL` ve `EXPO_PUBLIC_WEB_URL` EAS ortam değişkeni olarak tanımlanır (`eas env:create`), depoya yazılmaz. İlk kurulum sırası: `eas init` (proje kimliği `app.json` içine `extra.eas.projectId` olarak girer; push bunu gerektirir), `eas credentials` (APNs anahtarı, Android imza anahtarı; SHA-256 parmak izi buradan alınıp web ortamına yazılır), `eas build --profile preview`, mağaza hesapları hazır olunca `eas submit`.

Expo Go ile telefondan QR okutulur. Arka plan konumu Expo Go'da sınırlıdır; gerçek davranış geliştirme derlemesiyle (`expo run:android`, `expo run:ios`) ya da EAS derlemesiyle görülür. Simülatörde `localhost` çalışır, fiziksel cihazda bilgisayarın ağ adresi verilir.

Doğrulama: `pnpm --filter @resget/mobile typecheck` ve `pnpm --filter @resget/mobile test` (turbo bunları kök `typecheck` ve `test` görevlerinde çalıştırır). Testler yalnızca saf mantığı kapsar: API istemcisi (yenileme, oturum kapatma, hata kodu), konum kuyruğu, sekme / üyelik seçimi, sevk panosu kuralları, harita modelleri (kurye, müşteri takibi, sevk) ve navigasyon bağlantıları. Ekranlar cihazda denenir.

## 5. İzinler ve mağaza notları

- Android: `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`. Arka plan konumu için Play Console'da kullanım gerekçesi ve kısa video istenir; gerekçe "kurye seferi boyunca müşteriye canlı takip" olarak yazılır.
- Harita: Android derlemesi için `GOOGLE_MAPS_ANDROID_API_KEY` (yukarıda "Harita sağlayıcısı"); iOS için ek bir şey gerekmez.
- Push: APNs anahtarı ve FCM kimliği Expo projesinde tutulur (`eas credentials`); API tarafında yalnızca `PUSH_PROVIDER=EXPO` ve isteğe bağlı `EXPO_ACCESS_TOKEN` vardır.
- iOS: `UIBackgroundModes: location`, "Always" izni sefer başlarken istenir. App Store incelemesinde arka plan konumunun yalnızca aktif seferde çalıştığı belirtilir.
- Uygulama kimliği `com.resget.app`, URL şeması `resget://`. `/t/<token>` evrensel bağlantısı ve `resget://t/<token>` takip ekranını açar; `/m/<token>` masa QR'ı web'de kalır.
