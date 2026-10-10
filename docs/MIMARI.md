# Mimari

## Uygulamalar ve paketler

| Parça | Rol |
|---|---|
| `apps/api` | NestJS 11. Tüm iş mantığı burada. Prisma, Passport JWT, Swagger (yalnızca üretim dışı). |
| `apps/mobile` | Expo SDK 57, expo-router. Tek uygulama; sekmeler üyeliğin izinlerinden kurulur. API'ye doğrudan bearer ile gider, jetonlar cihaz anahtarlığında (`docs/MOBIL.md`). |
| `apps/web` | Next.js 15 App Router. Restoran paneli, herkese açık menü (`/m/<token>`), restoran sipariş sayfası (`/<slug>`), BFF proxy (`/api/bff/*`). İş mantığı yok. |
| `packages/shared` | Tek doğruluk kaynağı: enum'lar, Zod şemaları, izin kataloğu, `Money` ve hakediş motoru, plan kuralları, kurye arayüzü, masa QR, tasarım token'ları, i18n. |
| `packages/database` | Prisma şeması, ileri yönlü migration'lar, seed. |

## İstek akışı

1. Tarayıcı `/api/bff/<path>` çağırır. BFF, httpOnly çerezdeki erişim jetonunu `Authorization` başlığına çevirir ve isteği sabit, sunucu tarafı `API_INTERNAL_URL` adresine iletir. Hiçbir istemci API adresini belirleyemez.
2. API'de `@RestaurantScoped()` üç guard'ı sırayla çalıştırır:
   - `JwtAuthGuard`: jetonu doğrular, kullanıcıyı her istekte veritabanından okur (silinen kullanıcı anında kesilir).
   - `RestaurantTenantGuard`: `restaurantId`'yi rota, `x-restaurant-id` başlığı ve gövdeden okur; birden fazlası varsa aynı olmalıdır. Restoranın aktifliğini, üyeliğin `ACTIVE` olduğunu ve etkin planı (`effectivePlan`) çözer. Süper admin üyeliksiz tam yetkilidir.
   - `PermissionGuard`: handler'ın `@RequirePermission()` beyanı yoksa reddeder (deny by default); her izni etkin kümeye karşı denetler; `@RequirePlanFeature()` varsa plan katmanını denetler ve `PLAN_FEATURE_REQUIRED` döner.
3. Hatalar `ErrorCodeFilter` ile tek biçimde döner: gövdede `code`, başlıkta `x-error-code`, `x-request-id` yankısı. İstemci `errors.<code>` anahtarını çevirir; İngilizce `message` yalnızca log ve API tüketicileri içindir.

## Oturum (web)

Giriş telefon + tek kullanımlık koddur (`/giris`). Kod isteği BFF üzerinden API'ye gider; doğrulama `POST /api/session/verify` route handler'ında yapılır ve erişim ile yenileme jetonları yalnızca httpOnly çerezlerde saklanır (`resget_access`, `resget_refresh`); tarayıcı JavaScript'i hiçbir jetonu görmez. `middleware.ts`, `/panel/*` isteklerinde erişim çerezinin süresine bakar, bitmek üzereyse yenileme çerezi ile `POST /auth/refresh` çağırıp çerezleri tazeler, jeton yoksa veya API yenilemeyi reddederse `/giris?next=` adresine yönlendirir (API ulaşılamıyor ya da 5xx dönüyorsa çerezler silinmez, istek geçer ve oturum bir sonraki istekte yeniden denenir); `/m/*` isteklerinde anonim masa QR oturum çerezini açar. Doğrulama ve oturum aktarımı rotaları başka bir sitenin başlattığı istekte oturum çerezi yazmaz (`docs/GUVENLIK.md`, "Oturum kurma"). Çıkış `POST /api/session/logout` (düz form, JavaScript gerektirmez). `/panel` birden fazla üyelikte işletme seçtirir, tek üyelikte doğrudan `/panel/<slug>` açar; kabuk (`PanelShell`) menüyü üyenin etkin izinlerinden (`PANEL_NAV`, `visibleNav`) çizer ve işletmenin renginde render edilir. Masa QR sayfasındaki "telefon numaranla kaydol" bağlantısı aynı giriş akışını ad alanıyla açar; API `qrToken` ve `qrSessionId` ile `REGISTERED` huni olayını ve restoran müşteri kaydını yazar.

## Herkese açık uçlar

`/health`, `/auth/*`, `/public/qr/:token`, `/public/orders/:token` ve `/public/orders/:token/events`. Masa QR ucu, isteğe bağlı `x-qr-session` başlığıyla anonim huni olayı kaydeder; telefon numarası veya kimlik taşımaz. Sipariş takip uçları tahmin edilemez takip anahtarıyla yalnızca o siparişi ve yoldaki kuryenin adını ve konumunu verir.

## Canlı akış

Sipariş, sefer ve kurye konumu değişiklikleri Server-Sent Events ile yayınlanır (`RealtimeService`, `docs/SIPARIS_VE_SEVK.md`): süreç içi dağıtım, Redis pub/sub ile çoklu örnek, konu başına tekrar tamponu (`Last-Event-ID`), 25 saniyede kalp atışı. Üç kitle, üç uç: sevk panosu (`/restaurants/:id/dispatch/events`), kurye (`/restaurants/:id/courier/me/events`), müşteri (`/public/orders/:token/events`). BFF akışları tamponlamadan aktarır.

## Para

Tüm tutarlar tam sayı minör birim ve para birimi koduyla (`Money`). `computeOrderSettlement()` saf fonksiyondur, API'de `SettlementService` restoranın sözleşme değerlerini (komisyon, PSP oranı, ülke) bağlar. Sipariş kaydı sonucun anlık görüntüsünü taşır; defter (`LedgerEntry`) yalnızca eklemelidir. Ayrıntı: `docs/MUTABAKAT.md`.

## Sağlayıcı adaptörleri

| Alan | Arayüz | Bugün |
|---|---|---|
| SMS | `SmsProvider` (`SMS_PROVIDER` token'ı) | MOCK; üretimde göndermeyi reddeder |
| Kurye | `CourierProviderAdapter` + `CourierRegistry` | MOCK (mesafeye göre deterministik teklif) |
| Ödeme | `PAYMENT_PROVIDER` env (adaptör Faz 0 A4) | MOCK; üretimde env doğrulaması reddeder |
| Rota | `RoutingProviderAdapter` + `RoutingRegistry` (`ROUTING_PROVIDER`) | HAVERSINE (düz çizgi x sapma katsayısı); yol motoru adaptör olarak eklenir |

Yeni sağlayıcı eklemek adaptör yazmak ve kayıt etmektir; sipariş akışında kod yolu açılmaz.

## Ortam

`apps/api/src/config/env.ts` Zod ile doğrular; boş değer "ayarlanmamış" sayılır (compose her anahtarı `${KEY:-}` ile geçirir). Üretimde Redis, açık CORS listesi ve gerçek ödeme sağlayıcısı zorunludur.

## Üretim

Caddy (TLS) -> web (3000) ve api (4000) -> Postgres 16 ve Redis 7, hepsi tek sunucuda Docker Compose ile; imajlar CI'da derlenir. Bellek sınırları `deploy/docker-compose.prod.yml` içindedir.
