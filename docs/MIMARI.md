# Mimari

## Uygulamalar ve paketler

| Parça | Rol |
|---|---|
| `apps/api` | NestJS 11. Tüm iş mantığı burada. Prisma, Passport JWT, Swagger (yalnızca üretim dışı). |
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

## Herkese açık uçlar

`/health`, `/auth/*`, `/public/qr/:token`. Masa QR ucu, isteğe bağlı `x-qr-session` başlığıyla anonim huni olayı kaydeder; telefon numarası veya kimlik taşımaz.

## Para

Tüm tutarlar tam sayı minör birim ve para birimi koduyla (`Money`). `computeOrderSettlement()` saf fonksiyondur, API'de `SettlementService` restoranın sözleşme değerlerini (komisyon, PSP oranı, ülke) bağlar. Sipariş kaydı sonucun anlık görüntüsünü taşır; defter (`LedgerEntry`) yalnızca eklemelidir. Ayrıntı: `docs/MUTABAKAT.md`.

## Sağlayıcı adaptörleri

| Alan | Arayüz | Bugün |
|---|---|---|
| SMS | `SmsProvider` (`SMS_PROVIDER` token'ı) | MOCK; üretimde göndermeyi reddeder |
| Kurye | `CourierProviderAdapter` + `CourierRegistry` | MOCK (mesafeye göre deterministik teklif) |
| Ödeme | `PAYMENT_PROVIDER` env (adaptör Faz 0 A4) | MOCK; üretimde env doğrulaması reddeder |

Yeni sağlayıcı eklemek adaptör yazmak ve kayıt etmektir; sipariş akışında kod yolu açılmaz.

## Ortam

`apps/api/src/config/env.ts` Zod ile doğrular; boş değer "ayarlanmamış" sayılır (compose her anahtarı `${KEY:-}` ile geçirir). Üretimde Redis, açık CORS listesi ve gerçek ödeme sağlayıcısı zorunludur.

## Üretim

Caddy (TLS) -> web (3000) ve api (4000) -> Postgres 16 ve Redis 7, hepsi tek sunucuda Docker Compose ile; imajlar CI'da derlenir. Bellek sınırları `deploy/docker-compose.prod.yml` içindedir.
