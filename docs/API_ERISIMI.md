# API erişimi (Pro)

Restoranın kendi yazılımı (kasa, ERP, web sitesi) panelin kullandığı restoran uçlarını bir API anahtarıyla çağırır. Pro özelliği `api_access`; anahtar yalnızca seçilen yetkileri taşır ve her an iptal edilir. Kod: `packages/shared/src/api-keys.ts` (biçim, verilebilir yetkiler, sözleşmeler), `apps/api/src/modules/auth/api-keys.service.ts` ve `guards/api-key-or-jwt-auth.guard.ts` (doğrulama), `apps/api/src/modules/api-keys` (anahtar yönetimi uçları), `apps/web/src/components/panel/ApiKeysManager.tsx` (`/panel/<slug>/entegrasyon`).

## Değişmeyen kurallar

1. **Anahtar bir üyelik gibidir, daha fazlası değil.** Tek restorana bağlıdır (başka `restaurantId` ile çağrı 403), oluşturulurken seçilen yetki kümesini taşır ve oluşturan kişinin sahip olmadığı bir yetkiyi hiçbir zaman alamaz (`API_KEY_GRANTABLE_PERMISSIONS`: sipariş, menü, masa, müşteri, rapor, sevk, kurye, sadakat görüntüleme; personel, roller, faturalama, ayarlar ve anahtar yönetimi verilemez).
2. **Sır bir kez görünür.** Token biçimi `rsk_<keyId>_<secret>`; platform yalnızca sırrın anahtarın kimliği ve sunucu tarafı bir pepper ile tuzlanmış scrypt özetini saklar ve sabit zamanlı karşılaştırır; doğrulanan token bir dakika bellekte tutulur, iptal bunu hemen siler. Liste ve denetim kayıtları yalnızca `keyId` ve adı gösterir.
3. **Anahtar kişi gerektiren işi yapamaz.** `@SessionOnly()` uçları (anahtar oluşturma ve iptal) ve restoran kapsamı dışındaki oturum uçları (`me/*`, konsol) anahtarı reddeder. Anahtarla yapılan her işlem denetim kaydında onu oluşturan üyeye yazılır.
4. **Plan düşerse anahtar durur, silinmez.** `api_access` taşımayan planda her anahtarlı çağrı `PLAN_FEATURE_REQUIRED` ile 403 döner; plan dönünce aynı anahtar çalışır.
5. **Geçersiz anahtar oturuma düşmez.** `x-api-key` başlığı varsa yalnızca anahtar değerlendirilir; bozuk, bilinmeyen veya iptal edilmiş anahtar 401'dir, yanında bearer olsa bile.

## Kullanım

- Temel adres: `PUBLIC_API_URL` (üretimde `https://<API_DOMAIN>`). Her isteğe `x-api-key: rsk_...` başlığı eklenir; `restaurantId` yoldaki değerdir.
- Yanıtlar panelle aynıdır: hata gövdeleri `x-error-code` başlığı taşır (`docs/` genel kuralı), para tam sayı minör birim ve para birimi koduyla gelir, tarihler ISO 8601 UTC.
- Örnek: siparişleri listelemek `GET /restaurants/<id>/orders`, siparişi kabul etmek `POST /restaurants/<id>/orders/<orderId>/transition` gövde `{ "to": "ACCEPTED", "prepMinutes": 15 }`, menüyü okumak `GET /restaurants/<id>/menu`, ürünü tükendi işaretlemek `PATCH /restaurants/<id>/menu/items/<itemId>`. Tam liste geliştirme ortamında `/api/docs` (Swagger, `api-key` güvenlik şeması).
- Canlı sipariş akışı için SSE uçları (`docs/SIPARIS_VE_SEVK.md`) da anahtarla açılır; `orders.view` yeterlidir.

## Uçlar (`restaurants/:id/api-keys`, `integrations.manage`, `@RequirePlanFeature('api_access')`, yalnızca oturum)

- `GET`: anahtarlar (ad, `keyId`, yetkiler, son kullanım, oluşturan, iptal zamanı); iptal edilenler listede kalır.
- `POST { name, permissions[] }`: yeni anahtar; yanıt token'ı yalnızca bu kez içerir. Oluşturanın sahip olmadığı yetki 403.
- `POST :keyId/revoke`: iptal; kullanan sistemler 401 almaya başlar. `API_KEY_NOT_FOUND` 404.

`lastUsedAt` en çok dakikada bir yazılır; yoğun bir entegrasyon her çağrıda güncelleme üretmez.

## Ekran

`/panel/<slug>/entegrasyon` (`integrations.manage`; varsayılan rollerde yalnızca sahip): nasıl kullanılır kartı (temel adres, başlık adı), yeni anahtar formu (ad ve yetki kutuları), yalnızca oluşturma anında görünen token kartı, anahtar listesi ve iptal. Temel planda form kapalı ve plan notu görünür.

## Testler

API e2e `api-keys.e2e-spec.ts`: oluşturma ve tek seferlik token, listede sır yok, verilen ve verilmeyen yetkiler, verilemeyen yetki, yalnızca oturum uçları, başka restoran, bozuk anahtar ve bearer ile birlikte, `me/*` reddi, Temel planda 403, iptal sonrası 401, bulunamayan anahtar. Playwright `api-keys.e2e.ts`: oluşturma, token kartı, iptal.

## Kalan

- Anahtar başına oran sınırı ve kullanım sayacı (bugün yalnızca `lastUsedAt`).
- Webhook'lar (sipariş olaylarını restoranın adresine itme); bugün SSE ile çekilir.
- Anahtar son kullanma tarihi.
