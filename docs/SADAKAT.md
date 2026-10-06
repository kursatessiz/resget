# Sadakat programı (Pro)

Müşteri her tamamlanan siparişte puan kazanır, puanını bir sonraki siparişte indirim olarak harcar. Pro planının özelliğidir (`PLAN_FEATURE_SETS.PRO`, özellik `loyalty`); Temel plandaki restoran kuralları salt okunur görür. Kod: `packages/shared/src/loyalty.ts` (kurallar ve aritmetik), `apps/api/src/modules/loyalty` (servis ve uçlar), sipariş kancaları `apps/api/src/modules/orders/orders.service.ts` ve `apps/api/src/modules/storefront/storefront.service.ts`, ekranlar `apps/web/src/components/panel/LoyaltyManager.tsx`, `CustomersList.tsx`, `Storefront.tsx`, `AccountPanel.tsx`.

## Değişmeyen kurallar

1. **İndirimi restoran karşılar.** Puan indirimi `discountFundedBy = RESTAURANT` olarak siparişe yazılır; komisyon ve tevkifat indirimli ürün toplamı üzerinden hesaplanır (`computeOrderSettlement`, `docs/MUTABAKAT.md`). Platform indirimin hiçbir parçasını üstlenmez, komisyondan da düşmez.
2. **Puan tam sayıdır, her hareket kayıtlıdır.** Bakiye `restaurant_customers.loyaltyPoints` sütunundadır; her değişiklik yalnızca ekleme yapılan `loyalty_transactions` satırıdır (`EARN`, `WELCOME`, `REDEEM`, `REVERSAL`, `ADJUSTMENT`; işaretli puan ve işlem sonrası bakiye). Bakiye asla eksiye düşmez.
3. **Puan telefon numarasına aittir ve yalnızca giriş yapmış müşteri harcayabilir.** Kazanım telefonla verilen her siparişte (giriş olmadan da) o restorandaki `RestaurantCustomer` satırına yazılır; harcama için OTP ile giriş gerekir ve siparişteki telefon giriş yapılan numarayla aynı olmalıdır (`LOYALTY_SIGN_IN_REQUIRED`, `LOYALTY_PHONE_MISMATCH`).
4. **Plan düşerse puan durur, silinmez.** Program açık olsa da plan Pro değilse (`active = false`) sipariş puan kazandırmaz, vitrin kuralları göstermez, puan harcanamaz (`LOYALTY_NOT_ACTIVE`). Bakiyeler ve geçmiş yerinde kalır; plan dönünce kaldığı yerden sürer.

## Kurallar (restoran verisi, `loyalty_programs`)

| Alan | Anlamı |
| --- | --- |
| `enabled` | Program açık mı |
| `earnPoints` / `earnStepMinor` | Her `earnStepMinor` (restoranın para biriminde minör birim) harcamaya `earnPoints` puan; tam adım sayılır |
| `redeemPoints` / `redeemValueMinor` | `redeemPoints` puan `redeemValueMinor` indirim eder |
| `minOrderMinor` | Puan harcamak için gereken en az ürün toplamı |
| `maxDiscountBps` | İndirim ürün toplamının en çok bu payı olabilir; kalan puan bakiyede kalır |
| `welcomePoints` | İlk tamamlanan siparişte bir kez verilen bonus |

Satır yoksa ekran para birimine göre varsayılan önerir: 1 birim harcamaya 1 puan, 100 puan 10 birim indirim, tavan yüzde 50, kapalı (`LOYALTY_PROGRAM_DEFAULTS`, `minorDigitsOf`). Hesap fonksiyonları: `pointsEarnedFor(rule, spendMinor)`, `redeemableFor(rule, balance, itemsGrossMinor)` (tam adım, tavan ve ürün toplamıyla sınırlı), `balanceValueMinor`.

## Akış

- **Harcama (yerleştirme):** vitrin `PublicOrderSchema.useLoyaltyPoints = true` gönderir. `StorefrontController` sipariş uçlarında `OptionalJwtAuthGuard` ile giriş yapmış ziyaretçiyi tanır; `OrdersService.create(..., { loyaltyUserId })` harcanabilir puanı `prepareRedemption` ile hesaplar, indirimi hakedişe verir ve siparişle aynı veritabanı işleminde `applyRedemption` ile puanı düşer (bakiye koşullu `updateMany`: iki sekme aynı puanı iki kez harcayamaz). Yanıt `discountMinor` ve `loyaltyPointsRedeemed` taşır. İletişim bilgisi olmayan masa siparişinde puan harcanıyorsa sipariş giriş yapan kişinin adı ve telefonuyla bağlanır.
- **Kazanım (tamamlanma):** `applyTransition` `DELIVERED` veya `PICKED_UP` geçişinde `recordCompletion` çağırır: harcama tabanı `itemsGrossMinor - discountMinor`; ilk kazanımda `WELCOME` satırı ve `loyaltyJoinedAt`. Aynı sipariş için ikinci kez yazılmaz.
- **İade:** `REJECTED`, `CANCELLED_BY_*` veya `REFUNDED` geçişinde `recordReversal` harcanan puanı geri verir, kazanılmış puanı (bakiyeyi aşmadan) geri alır; sipariş başına tek `REVERSAL` satırı. Ödeme bekleyen ve hiç tamamlanmayan siparişin puanı iptal edilene kadar bağlı kalır.
- **Düzeltme:** `POST .../loyalty/customers/:customerId/adjust` (`loyalty.manage`, Pro) `ADJUSTMENT` satırı ve denetim kaydı yazar; eksi düzeltme bakiyeyi aşamaz (`LOYALTY_INSUFFICIENT_POINTS`).

## Uçlar

- `GET /restaurants/:id/loyalty` (`loyalty.view`): kurallar (`active` ile), sayaçlar (puanı olan müşteri, bekleyen, kazanılan, harcanan puan, tamamlanan siparişlerde verilen indirim) ve son 20 hareket.
- `PUT /restaurants/:id/loyalty` (`loyalty.manage`, `@RequirePlanFeature('loyalty')`): kuralları yazar (`LoyaltyProgramSchema`), denetim kaydı düşer.
- `GET /restaurants/:id/loyalty/customers/:customerId` (`loyalty.view` + `customers.view`): bakiye ve son 50 hareket. `POST .../adjust`: düzeltme.
- Herkese açık menü yanıtı (`GET /public/qr/:token`, `GET /public/restaurants/:slug/menu`): `loyalty` alanı, yalnızca etkin programda.
- `GET /me/viewer?restaurantId=`: o restorandaki bakiye (`loyaltyPoints`); `GET /me/account`: puanı olan restoranlar ve bugünkü değeri (`loyalty[]`).
- Müşteri listesi (`GET /restaurants/:id/customers`): her müşteride `loyaltyPoints`.

İzinler: `loyalty.view`, `loyalty.manage` (sahip ve yönetici şablonunda; `permissions.ts`).

## Ekranlar

- `/panel/<slug>/sadakat` (`loyalty.view`): durum rozeti (açık / kapalı / plan Pro değil), kural formu (tutarlar restoranın para biriminde, tavan yüzde olarak), sayaç kartları, son hareketler. Temel planda form salt okunur ve plan notu görünür.
- `/panel/<slug>/musteriler`: her müşteride puan; `loyalty.manage` ile kartta puan düzeltme (puan ve neden).
- Vitrin (`/m/<token>`, `/<slug>`): sepet özetinde bakiye, "{puan} puan kullan, {tutar} indirim al" kutusu, indirim satırı ve bu siparişle kazanılacak puan; giriş yapmamış ziyaretçiye giriş çağrısı.
- `/hesabim`: "Puanlarım" kartı, restoran başına bakiye ve bugünkü değeri, sipariş bağlantısı.
- Mobil uygulama: "Siparişlerim" ekranında aynı kart (`docs/MOBIL.md`), yalnızca puanı olan müşteriye.

## Testler

Shared `loyalty.spec.ts` (kazanım adımları, tavan ve en az sipariş, şema). API e2e `loyalty.e2e-spec.ts`: varsayılanlar ve kayıt, tamamlanan siparişte kazanım ve hoş geldin bonusu (bir kez), giriş zorunluluğu ve telefon eşleşmesi, harcama ve indirimli hakediş, retle iade, düzeltme sınırı, müşteri listesinde puan, Temel plana düşüşte kapı. Web e2e `loyalty.e2e.ts`: sahibin programı açması ve rozetin değişmesi.

## Kalan

- Puan hareketlerinin müşteriye bildirimi (mesajlaşma motoru, kredi düşer; restoran tercihi olarak).
- Kademeli program (gümüş / altın) ve ürün bazlı çarpanlar.
