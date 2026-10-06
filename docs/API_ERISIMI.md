# API erişimi (Pro)

Restoranın kendi yazılımı (kasa, ERP, web sitesi) panelin kullandığı restoran uçlarını bir API anahtarıyla çağırır. Pro özelliği `api_access`; anahtar yalnızca seçilen yetkileri taşır ve her an iptal edilir. Kod: `packages/shared/src/api-keys.ts` (biçim, verilebilir yetkiler, sözleşmeler), `apps/api/src/modules/auth/api-keys.service.ts` ve `guards/api-key-or-jwt-auth.guard.ts` (doğrulama), `apps/api/src/modules/api-keys` (anahtar yönetimi uçları), `apps/web/src/components/panel/ApiKeysManager.tsx` (`/panel/<slug>/entegrasyon`).

## Değişmeyen kurallar

1. **Anahtar bir üyelik gibidir, daha fazlası değil.** Tek restorana bağlıdır (başka `restaurantId` ile çağrı 403), oluşturulurken seçilen yetki kümesini taşır ve oluşturan kişinin sahip olmadığı bir yetkiyi hiçbir zaman alamaz (`API_KEY_GRANTABLE_PERMISSIONS`: sipariş, menü, masa, müşteri, rapor, sevk, kurye, sadakat görüntüleme; personel, roller, faturalama, ayarlar ve anahtar yönetimi verilemez).
2. **Sır bir kez görünür.** Token biçimi `rsk_<keyId>_<secret>`; platform yalnızca sırrın anahtarın kimliği ve sunucu tarafı bir pepper ile tuzlanmış scrypt özetini saklar ve sabit zamanlı karşılaştırır; doğrulanan token bir dakika bellekte tutulur, iptal bunu hemen siler. Liste ve denetim kayıtları yalnızca `keyId` ve adı gösterir.
3. **Anahtar kişi gerektiren işi yapamaz.** `@SessionOnly()` uçları (anahtar oluşturma ve iptal) ve restoran kapsamı dışındaki oturum uçları (`me/*`, konsol) anahtarı reddeder. Anahtarla yapılan her işlem denetim kaydında onu oluşturan üyeye yazılır.
4. **Plan düşerse anahtar durur, silinmez.** `api_access` taşımayan planda her anahtarlı çağrı `PLAN_FEATURE_REQUIRED` ile 403 döner; plan dönünce aynı anahtar çalışır.
5. **Geçersiz anahtar oturuma düşmez.** `x-api-key` başlığı varsa yalnızca anahtar değerlendirilir; bozuk, bilinmeyen veya iptal edilmiş anahtar 401'dir, yanında bearer olsa bile.
6. **Süresi dolan anahtar kendi koduyla reddedilir.** Anahtar oluşturulurken bir geçerlilik süresi alabilir; süre dolunca her çağrı 401 `API_KEY_EXPIRED` döner. Böylece entegrasyon, yanlış anahtar (`UNAUTHORIZED`) ile süresi dolmuş anahtarı ayırt eder. Süre uzatılmaz; yeni anahtar oluşturulur.

## Kullanım

- Temel adres: `PUBLIC_API_URL` (üretimde `https://<API_DOMAIN>`). Her isteğe `x-api-key: rsk_...` başlığı eklenir; `restaurantId` yoldaki değerdir.
- Yanıtlar panelle aynıdır: hata gövdeleri `x-error-code` başlığı taşır (`docs/` genel kuralı), para tam sayı minör birim ve para birimi koduyla gelir, tarihler ISO 8601 UTC.
- Örnek: siparişleri listelemek `GET /restaurants/<id>/orders`, siparişi kabul etmek `POST /restaurants/<id>/orders/<orderId>/transition` gövde `{ "to": "ACCEPTED", "prepMinutes": 15 }`, menüyü okumak `GET /restaurants/<id>/menu`, ürünü tükendi işaretlemek `PATCH /restaurants/<id>/menu/items/<itemId>`. Tam liste geliştirme ortamında `/api/docs` (Swagger, `api-key` güvenlik şeması).
- Canlı sipariş akışı için SSE uçları (`docs/SIPARIS_VE_SEVK.md`) da anahtarla açılır; `orders.view` yeterlidir.

## Uçlar (`restaurants/:id/api-keys`, `integrations.manage`, `@RequirePlanFeature('api_access')`, yalnızca oturum)

- `GET`: anahtarlar (ad, `keyId`, yetkiler, son kullanım, oluşturan, iptal zamanı, son geçerlilik `expiresAt`, son 30 gündeki istek sayısı `requestsLastDays`); iptal edilenler ve süresi dolanlar listede kalır.
- `POST { name, permissions[], expiresInDays? }`: yeni anahtar; yanıt token'ı yalnızca bu kez içerir. Oluşturanın sahip olmadığı yetki 403.
  - `expiresInDays` yalnızca 30, 90, 180 veya 365 olabilir (`API_KEY_EXPIRY_DAYS`); verilmezse veya `null` ise anahtar iptal edilene kadar çalışır. Başka bir değer 400 döner.
- `GET :keyId/usage`: anahtarın son 30 günlük kullanımı (aşağıda "Kullanım"). `API_KEY_NOT_FOUND` 404.
- `POST :keyId/revoke`: iptal; kullanan sistemler 401 almaya başlar. `API_KEY_NOT_FOUND` 404.

`lastUsedAt` en çok dakikada bir yazılır; yoğun bir entegrasyon her çağrıda güncelleme üretmez.

## Kullanım

Her anahtarın istekleri UTC gününe göre sayılır (`restaurant_api_key_usage`: anahtar, gün, istek sayısı).

- **Ne sayılır**: geçerli bir anahtarla gelen her istek, oran sınırına takılanlar dahil. Bozuk, bilinmeyen, iptal edilmiş veya süresi dolmuş anahtarla gelen istek sayılmaz.
- **Nasıl yazılır**: sayaç süreç belleğinde tutulur ve dakikada bir toplu olarak eklenir. Liste ve rapor okunmadan önce bekleyen sayılar yazılır; süreç kapanırken de yazılır. Yazılamayan sayı kaybolmaz, bir sonraki turda yeniden denenir.
- **Rapor**: `GET :keyId/usage` son 30 günü (bugün dahil, `API_KEY_USAGE_DAYS`) eskiden yeniye döner. Her gün `{ day: "YYYY-MM-DD", requests }` biçimindedir; isteksiz günler sıfırdır. Yanıt `total` toplamını da taşır.
- **Çoklu örnek**: her API örneği kendi sayacını yazar; satır artırımla güncellendiği için toplam doğru kalır.

## Webhook'lar

Restoranın yazılımı siparişleri çekmek yerine itilmesini de isteyebilir (`packages/shared/src/webhooks.ts`, `apps/api/src/modules/webhooks`). Adres ve olaylar panelden kaydedilir (`restaurants/:id/webhooks`, `integrations.manage`, Pro, yalnızca oturum: `GET`, `POST`, `PATCH :id` (adres, olaylar, duraklat / sürdür), `DELETE :id`, `POST :id/test`, `GET :id/deliveries`). İmza sırrı (`whsec_...`) yalnızca oluşturma yanıtında görünür; platform `CredentialCipher` ile şifreli saklar. Üretimde yalnızca `https` adres kabul edilir (`WEBHOOK_URL_INVALID`).

- **Olaylar**: `order.updated` (sipariş oluşturma dahil her durum değişikliği; gövde sipariş özeti, `OrderSummaryDTO`), `rating.created` (müşteri değerlendirmesi: sipariş kimliği ve kısa kodu, puan, yorum).
- **Teslim**: her olay için `webhook_deliveries` satırı açılır; `WebhooksRunner` 30 saniyede bir vadesi gelenleri gönderir (`WEBHOOK_RUNNER=off` kapatır, testte kapalıdır ve `runPass()` doğrudan çağrılır). İstek `POST`, gövde `{ id, event, createdAt, data }`, başlıklar `x-resget-event`, `x-resget-delivery`, `x-resget-signature: t=<unix saniye>,v1=<hex>`; imza `HMAC-SHA256(sır, "<t>.<gövde>")`. Alıcı 2xx dönerse `SENT`; aksi halde 1 dk, 5 dk, 30 dk, 2 sa ve 6 sa sonra yeniden denenir, altıncı başarısızlıkta `FAILED`. Adres 20 ardışık başarısız teslimden sonra kendini duraklatır (`isActive = false`); başarılı teslim sayacı sıfırlar. Duraklatılmış adrese kuyruk açılmaz.
- **Alıcı tarafı**: imzayı kendi sırrınızla aynı biçimde hesaplayıp sabit zamanlı karşılaştırın, `t` değerinin 5 dakikadan eski olmadığını kontrol edin (`WEBHOOK_SIGNATURE_TOLERANCE_SECONDS`), `x-resget-delivery` kimliğiyle tekrarları eleyin (yeniden deneme aynı kimlikle gelir).

## Oran sınırı

Her anahtar dakikada `API_KEY_RATE_LIMIT` (varsayılan 600) istek yapabilir; aşımda `RATE_LIMITED` ile 403. Sayaç Redis varsa tüm API örneklerinde ortaktır, yoksa süreç belleğinde tutulur (`RateLimiterService`).

## Ekran

`/panel/<slug>/entegrasyon` (`integrations.manage`; varsayılan rollerde yalnızca sahip): nasıl kullanılır kartı (temel adres, başlık adı), yeni anahtar formu (ad ve yetki kutuları), yalnızca oluşturma anında görünen token kartı, anahtar listesi ve iptal. Formda geçerlilik süresi seçilir (süresiz, 30, 90, 180 veya 365 gün). Listede her anahtarın durumu (etkin, süresi doldu, iptal edildi), son geçerlilik tarihi ve son 30 gündeki istek sayısı görünür; "Kullanım" düğmesi istek olan günleri açar; webhook kartı (adres ve olaylar, bir kez görünen sır, deneme gönderimi, duraklat / sürdür, sil, son teslimler). Temel planda formlar kapalı ve plan notu görünür.

## Testler

API e2e `webhooks.e2e-spec.ts`: yerel bir alıcıya imzalı teslim ve imza doğrulaması, 500 yanıtında geri çekilmeli yeniden deneme ve sayaç, deneme gönderimi, duraklatmada kuyruk açılmaması, silme, anahtarla yönetim reddi. API e2e `api-keys.e2e-spec.ts`: oluşturma ve tek seferlik token, listede sır yok, verilen ve verilmeyen yetkiler, verilemeyen yetki, yalnızca oturum uçları, başka restoran, bozuk anahtar ve bearer ile birlikte, `me/*` reddi, Temel planda 403, iptal sonrası 401, bulunamayan anahtar; geçerlilik süresi ve süresi dolan anahtarda `API_KEY_EXPIRED`, izin verilmeyen süre, gün bazında sayım ve rapor, anahtarla rapor reddi. Playwright `api-keys.e2e.ts`: süreli oluşturma, token kartı, kullanım özeti ve raporu, iptal. Birim testi `packages/shared/src/api-keys.spec.ts`: süre seçenekleri, durum, UTC gün penceresi.

## Kalan

- Süresi yaklaşan anahtar için sahibe hatırlatma (mesajlaşma motoru).
- Webhook olaylarının genişlemesi (menü değişikliği, ödeme) ve alıcıya yeniden gönderme düğmesi.
