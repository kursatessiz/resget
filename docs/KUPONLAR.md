# Kuponlar ve indirim kodları

Restoranın kendi karşıladığı indirim kodları. Müşteri kodu sipariş verirken girer, indirim sepetten düşer. Pro plan özelliğidir (`coupons`) ve `coupons` modül anahtarının arkasındadır (`docs/OZELLIK_ANAHTARLARI.md`); anahtarın varsayılanı kapalıdır.

## Kurallar

Her kural restoran verisidir; kod yalnızca aritmetiği ve kontrolleri taşır (`packages/shared/src/coupons.ts`).

- **Tür**: yüzde (`percentBps`, isteğe bağlı üst sınır `maxDiscountMinor`) veya tutar (`amountMinor`). İndirim hiçbir zaman ürün toplamını aşmaz; yüzde hesabı `bpsOf()` ile tek yuvarlamayla yapılır.
- **En az sepet**: ürün toplamı (teslimat ücreti hariç) alt sınırın altındaysa `COUPON_MIN_BASKET`.
- **Yalnızca ilk sipariş**: telefon bu restorandan daha önce sipariş verdiyse `COUPON_FIRST_ORDER_ONLY`.
- **Müşteri başına kullanım**: telefon başına; iptal edilen sipariş hakkını geri verir. Aşılırsa `COUPON_ALREADY_USED`.
- **Toplam kullanım sınırı**: `redemptionCount` sayacı siparişle aynı işlemde, yalnızca sınırın altındayken atomik olarak artar; böylece sınırlı kupon fazla satılmaz (`COUPON_LIMIT_REACHED`). Sipariş reddedilir, iptal edilir veya iade edilirse kullanım geri verilir (`releasedAt`, sayaç bir azalır).
- **Geçerlilik penceresi**: başlamamış kupon bilinmeyen kod gibi davranır (`COUPON_NOT_FOUND`), süresi geçmiş kupon `COUPON_EXPIRED`.
- **Telefon gerekir**: kupon bir telefona bağlıdır; iletişim bilgisi olmayan masa siparişinde `COUPON_PHONE_REQUIRED`.
- **Sadakat puanıyla birleşmez**: bir siparişte tek indirim vardır (`COUPON_NOT_COMBINABLE`). Menü sayfası kupon uygulanınca puan kutusunu gizler.
- Kuralları oluşturulduktan sonra değişmez; yalnızca durdurulur veya yeniden açılır. Hiç kullanılmamış kupon silinebilir, kullanılmış kupon kayıt için kalır (`COUPON_IN_USE`).

## Para akışı

Kupon indirimi `discountFundedBy = RESTAURANT` olarak hakediş hesabına girer (`computeModeSettlement`, `docs/MUTABAKAT.md`): müşteri indirimli tutarı öder, platform komisyonu indirimli ürün tutarı üzerinden hesaplanır, indirim restoranın gelirinden düşer. Sadakat puanı indirimiyle aynı yol izlenir. Platformun karşıladığı indirim yoktur.

## Gizlilik

Herkese açık uç (`GET /public/restaurants/:slug/coupons/:code`) yalnızca önizleme için gereken alanları döner ve istemci başına oran sınırlıdır (10 dakikada 30 sorgu, `PUBLIC_COUPON_RATE_LIMIT`). Bilinmeyen, durdurulmuş, başlamamış kod, kapalı anahtar ve Pro olmayan plan hep aynı cevabı verir (`COUPON_NOT_FOUND`); müşteri uygulanmayan kodlar hakkında bir şey öğrenmez. Kesin kontrol siparişte yapılır.

## Uçlar

- `GET /restaurants/:id/coupons` (`campaigns.view`): kuponlar, sayılan kullanım ve toplam verilen indirim.
- `POST /restaurants/:id/coupons` (`campaigns.manage`, Pro): yeni kupon; kod restoran içinde benzersizdir (`COUPON_CODE_TAKEN`).
- `PATCH /restaurants/:id/coupons/:couponId` (`campaigns.manage`): `{ isActive }`.
- `DELETE /restaurants/:id/coupons/:couponId` (`campaigns.manage`): yalnızca kullanılmamış kupon.
- Herkese açık sipariş gövdesinde `couponCode`; menü yanıtında `ordering.coupons` alanı kupon kutusunun gösterilip gösterilmeyeceğini söyler.

Her oluşturma, durdurma, açma ve silme denetim kaydına yazılır.

## Panel ve vitrin

- `/panel/<slug>/kuponlar`: kupon listesi (durum, kurallar, kullanım ve toplam indirim), yeni kupon formu, durdur / aç / sil. Menü bağlantısı anahtar açıkken görünür.
- Menü sayfası: sepette "Kupon kodu" kutusu; kod uygulanınca indirim satırı ve toplam güncellenir, alt sınır ve ilk sipariş notları gösterilir.

## Henüz yok

Bir alana bir bedava, belirli ürüne bedava ürün ve ücretsiz teslimat kuponu; müşteriye özel tek kullanımlık kod üretimi (kampanya mesajıyla); otomatik sepet indirimi (kodsuz).
