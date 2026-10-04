# Mobil Uygulama

`apps/mobile`, Expo SDK 57 ve expo-router ile yazılmış tek uygulamadır. Kurye, resepsiyon, sahip ve ileride müşteri aynı uygulamayı kullanır; hangi ekranların görüneceğine kullanıcının seçili işletmedeki üyeliği ve etkin izinleri karar verir. Bu belge ilk sürümün (B1 kısım 1) kapsamını, mimarisini ve çalıştırma yolunu anlatır. Kurye akışının API sözleşmesi `docs/SIPARIS_VE_SEVK.md` bölüm 7'dedir.

## 1. Kapsam

İlk sürümde olanlar:

- Telefon + tek kullanımlık kod ile giriş (`POST /auth/otp/request`, `POST /auth/otp/verify`), web ile aynı akış.
- Üyelikler arası işletme değiştirici; son seçilen işletme cihazda saklanır ve uygulama orada açılır.
- Kurye modu (`courier.deliver` izni): atanmış seferler, sefer ekranında tek "sıradaki adım" düğmesi (teslim al, yola çık, vardım, teslim ettim), teslim edilemedi ve sebebi, müşteriyi arama, navigasyon bağlantısı, durak başına mesafe ve tahmini varış.
- Arka plan konum paylaşımı: sefer `IN_PROGRESS` olduğu sürece konum görevi çalışır, ekran kapalıyken de toplar; noktalar seyreltilir ve partiler halinde `POST /restaurants/:id/courier/me/location` adresine gider.
- Sipariş listesi (`orders.view` izni): salt okunur, 15 saniyede bir yenilenir. Mutfak akışı web panelinde ve tablet panosunda kalır.
- Hesap: kim giriş yapmış, işletme değiştirici, çıkış.

Henüz olmayanlar: müşteri modu (sipariş takibi, tekrar sipariş, QR'dan derin bağlantı), kurye ekranında harita, restoran tablet sevk panosu, push bildirimi, EAS derleme ve mağaza yayını. Bunlar `HANDOVER.md` B1 maddesinde kalan iş olarak listelenir.

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
    (app)/siparisler.tsx   sipariş listesi
    (app)/hesap.tsx        hesap ve işletme değiştirici
  src/
    lib/api.ts             ApiClient: bearer, 401'de tek yenileme, x-restaurant-id
    lib/session.ts         expo-secure-store ile jeton ve son işletme
    lib/tabs.ts            tabsFor, pickMembership
    lib/location-batch.ts  LocationQueue: seyreltme, doğruluk filtresi, kuyruk sınırı, parti
    lib/location-tracker.ts expo-task-manager görevi, başlat / durdur / gönder
    lib/i18n.ts            cihaz dili, paylaşılan çevirmen
    lib/config.ts          EXPO_PUBLIC_API_URL, sürüm
    state/session.tsx      SessionProvider / useSession
    components/ui.tsx      Screen, Title, Body, Caption, Card, Button, Field, Notice
    theme.ts               paylaşılan token'lardan tema
  locales/                 iOS izin metinlerinin çevirileri (app.json locales)
```

## 3. Mimari kararlar

- **İş mantığı yok.** Uygulama API'nin DTO'larını (`@resget/shared`) gösterir ve API uçlarını çağırır. Durum geçişleri, hakediş, izin kontrolü API'dedir; uygulama yalnızca sıradaki adımı seçer (`nextAction`).
- **Doğrudan API, BFF yok.** Web'deki httpOnly çerez modeli tarayıcı içindir. Mobilde erişim ve yenileme jetonları cihazın anahtarlığında ya da keystore'unda tutulur (`expo-secure-store`); `ApiClient` her isteğe bearer ekler, 401 alınca bir kez `POST /auth/refresh` dener, o da reddedilirse oturumu kapatır ve giriş ekranına döner. Aynı anda gelen isteklerde tek yenileme çalışır.
- **Kiracı kapsamı başlıkla.** `restaurantId` verilen istekler `x-restaurant-id` başlığını taşır; yollar zaten `/restaurants/:id/...` biçimindedir.
- **Sekmeler izinlerden.** `tabsFor(permissions)` yalnızca `courier.deliver` ve `orders.view` izinlerine bakar; hesap sekmesi her zaman vardır. Yeni bir rol ekranı eklemek yeni bir izin eşlemesidir, rol adı kontrolü değildir.
- **Konum yalnızca seferde.** Görev, listede `IN_PROGRESS` sefer varken başlar ve kalmayınca durur; API zaten aktif seferi olmayan kuryenin noktalarını saklamaz (`tracked: false`). `LocationQueue` 3 saniyeden sık noktaları atar, 100 metreden kötü doğruluğu göndermez, çevrim dışında en fazla 600 nokta tutar (en eskiler düşer) ve API sınırı olan 60'lık partiler halinde gönderir; parti yalnızca API kabul edince unutulur, böylece bağlantı kopukluğu sonrası iz tekrar oynatılır.
- **Tasarım token'ları paylaşılan paketten.** `theme.ts` renkleri `semanticColors` ve `PERFECT_UI_TOKENS` içinden, boşluk ve köşeleri `spacing` / `radii` içinden alır; uygulamada başka renk veya köşe tanımı yoktur. Açık / koyu mod cihazı izler.
- **i18n.** Metinler `packages/shared/src/i18n/messages/{tr,en}/mobile.ts` içindedir (`mobile.*`); sipariş ve hata metinleri web ile aynı anahtarları kullanır (`orders.*`, `errors.*`). Dil cihazdan gelir (`expo-localization`), paket yoksa temel dil kullanılır. Arka plan servisi bildirimi de çevirmenden geçer; iOS izin metinleri `locales/*.json` ile çevrilir.
- **Gizli bilgi yok.** Pakete yalnızca `EXPO_PUBLIC_API_URL` ve `EXPO_PUBLIC_APP_VERSION` girer. Anahtar, imza ya da sağlayıcı bilgisi uygulamada bulunmaz.

## 4. Çalıştırma

```
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@resget/shared
EXPO_PUBLIC_API_URL=http://<bilgisayar-ip>:4000 pnpm --filter @resget/mobile start
```

Expo Go ile telefondan QR okutulur. Arka plan konumu Expo Go'da sınırlıdır; gerçek davranış geliştirme derlemesiyle (`expo run:android`, `expo run:ios`) ya da EAS derlemesiyle görülür. Simülatörde `localhost` çalışır, fiziksel cihazda bilgisayarın ağ adresi verilir.

Doğrulama: `pnpm --filter @resget/mobile typecheck` ve `pnpm --filter @resget/mobile test` (turbo bunları kök `typecheck` ve `test` görevlerinde çalıştırır). Testler yalnızca saf mantığı kapsar: API istemcisi (yenileme, oturum kapatma, hata kodu), konum kuyruğu ve sekme / üyelik seçimi. Ekranlar cihazda denenir.

## 5. İzinler ve mağaza notları

- Android: `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`. Arka plan konumu için Play Console'da kullanım gerekçesi ve kısa video istenir; gerekçe "kurye seferi boyunca müşteriye canlı takip" olarak yazılır.
- iOS: `UIBackgroundModes: location`, "Always" izni sefer başlarken istenir. App Store incelemesinde arka plan konumunun yalnızca aktif seferde çalıştığı belirtilir.
- Uygulama kimliği `com.resget.app`, URL şeması `resget://`. Müşteri modu geldiğinde `/m/<token>` ve `/t/<token>` evrensel bağlantıları bu şemaya eşlenir.
