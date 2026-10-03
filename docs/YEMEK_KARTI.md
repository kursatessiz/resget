# Yemek kartları ile ödeme

Türkiye'de öğle yemeğinin önemli bir bölümü yemek kartıyla ödenir: Multinet, Edenred (Ticket Restaurant), Pluxee (eski Sodexo), Setcard, Metropol, Yemekmatik, Paye, Tokenflex. Bu belge yemek kartlarının platformdaki modelini, iki kabul şeklini, para akışını ve API'yi tanımlar. Kural kodu `packages/shared/src/meal-cards.ts`, API tarafı `apps/api/src/modules/payments` (`MealCardsService`, `CheckoutService`).

## 1. Değişmeyen kurallar

1. **Üye işyeri restorandır, platform değil.** Yemek kartı yalnızca üye restoranda yemek için kullanılabilir; tahsilat kart kuruluşundaki restoran hesabına gider. Platform bu akışta hiçbir zaman para tutmaz. Bu, `OWN_POS` modeliyle aynıdır: her kart kuruluşu için restoran kendi üye işyeri sözleşmesini yapar ve API bilgilerini platforma bağlar; platform tek entegrasyon noktası sunar.
2. **Komisyon değişmez.** Yemek kartıyla ödenen sipariş de yüzde 1 komisyona tabidir; `platformReceivableMinor` olarak ay sonu faturasına girer. Kart kuruluşunun restorandan kestiği komisyon (genellikle yüzde 4 ila 7) restoranla kuruluş arasındadır, platform defterine girmez.
3. **Hakediş modu yönteme göre seçilir** (`effectivePaymentModeFor`): yalnızca çevrim içi kart ödemesi restoranın `paymentMode`'una göre tahsil edilir. Nakit, kapıda kart ve her yemek kartı restoranın kendisi tarafından tahsil edilir; bu nedenle `PLATFORM_PSP` restoranında bile `OWN_POS` gibi hesaplanır (PSP kesintisi ve tevkifat sıfır, komisyon faturalanır). Sipariş kaydı bu modu üzerinde taşır (`Order.paymentMode`).
4. **Her kart kuruluşu bir adaptördür** (`MealCardAdapter`: `verifyCredentials`, `createHostedCheckout`, `refund`, `parseWebhook`). Kuruluşun bilgileri `CredentialCipher` ile şifrelenir, hiçbir yanıt veya logda şifresiz görünmez. Webhook imza doğrulanmadan işlenmez. Kart numarası platforma girmez; çevrim içi ödeme kuruluşun kendi sayfasında veya OTP akışında tamamlanır.

## 2. İki kabul şekli

| | Kapıda (`acceptsOnDelivery`) | Çevrim içi (`acceptsOnline`) |
|---|---|---|
| Ne gerekir | Hiçbir şey; restoran "bu kartı kabul ediyoruz" der | Kuruluşun çevrim içi ödeme API'si için üye işyeri bilgileri ve platformda o kuruluşun adaptörü |
| Nasıl ödenir | Kurye veya kasa fiziksel kartı kuruluşun POS'undan geçirir, uygulamada tahsilatı kaydeder | Müşteri sipariş sonunda kuruluşun hosted sayfasına yönlenir, kart bakiyesinden öder |
| Sipariş durumu | Hemen `PLACED`; ödeme `PENDING`, kapıda `CAPTURED` olur | `PENDING_PAYMENT`; kuruluşun webhook'u gelince `PLACED` |
| Bugün | Tüm kuruluşlar için açık | Yalnızca adaptörü olan kuruluşlar (geliştirmede `MOCK`); gerçek adaptörler sözleşme ve API dokümanı geldikçe eklenir |

Restoran kabul ettiği kartları panelden seçer (`PUT /restaurants/:id/payments/meal-cards`, izin `payments.manage`); çevrim içi kabul için bilgiler kuruluşta doğrulanır (`ACTIVE` / `FAILED`), kapıda kabul için doğrulama yoktur. Katalog (`GET .../meal-cards`) restoranın ülkesindeki kuruluşları ve her biri için çevrim içi adaptörün hazır olup olmadığını (`onlineAvailable`) döner. Menü sayfası ve herkese açık `GET /public/restaurants/:slug/payment-methods` ucu kabul edilen kartları kuruluş adıyla listeler; kimlik veya bilgi taşımaz.

## 3. Sipariş akışında ödeme adımı

Sipariş oluşturulurken ödeme niyeti verilir (`CreateOrderSchema.payment`: `ONLINE_CARD`, `CASH_ON_DELIVERY`, `CARD_ON_DELIVERY`, `MEAL_CARD` + `providerCode` + isteğe bağlı `atDoor`). `CheckoutService.resolveIntent` restoranın kabul listesine bakar:

- Kabul edilmeyen yöntem veya kart `PAYMENT_METHOD_NOT_ACCEPTED` ile reddedilir.
- Yemek kartı çevrim içi kabul ediliyorsa ve `atDoor` verilmemişse ödeme şimdi alınır; çevrim içi adaptör yoksa kart kapıda alınır ve sipariş hemen yerleşir (yanıt `payment.status: PENDING`, `dueMinor` kapıda tahsil edilecek tutardır).
- Her siparişle bir `Payment` satırı açılır (yöntem, kuruluş kodu, tutar, mod); `OrderSummaryDTO.payment` ekranlara yöntem, kuruluş, durum ve kalan tutarı verir (kurye uygulaması "Multinet ile 895 TL tahsil et" der).

**Çevrim içi ödeme**: `POST /restaurants/:id/orders/:orderId/checkout` (personel) veya `POST /public/orders/:token/checkout` (müşteri, takip anahtarıyla) bir hosted ödeme oturumu açar (`redirectUrl`). Yemek kartında kuruluş adaptörü ve restoranın şifreli bilgileri, kredi kartında `OWN_POS` için restoranın POS bağlantısı, `PLATFORM_PSP` için platformun PSP'si kullanılır. Kuruluş sonucu `POST /webhooks/payments/meal-cards/:connectionId` (yemek kartı) veya `POST /webhooks/payments/pos/:connectionId` (sanal POS) ucuna bildirir; bağlantı kimliği imzayı doğrulayacak bilgileri seçer, ham gövde üzerinden imza kontrol edilir (`rawBody`), tutar sipariş tutarıyla eşleşmezse reddedilir, aynı bildirim ikinci kez gelirse hiçbir şey değişmez. `CAPTURED` bildirimi ödemeyi kapatır ve `PENDING_PAYMENT` siparişi `SYSTEM` aktörüyle `PLACED` yapar; sevk panosu ve müşteri takip sayfası aynı anda olayı alır.

**Kapıda tahsilat**: `POST /restaurants/:id/orders/:orderId/collect` (personel, `orders.manage`) veya `POST /restaurants/:id/courier/me/trips/:tripId/stops/:stopId/collect` (kurye, yalnızca kendi seferinin durağı). Gövde: yöntem, yemek kartında kuruluş, isteğe bağlı tutar (kısmi tahsilat) ve fiş numarası. Müşteri kapıda yöntem değiştirebilir (yemek kartı niyetiyle verip nakit ödeyebilir); kaydedilen yöntem siparişe yazılır, kim tahsil ettiği `collectedByUserId` ile tutulur. Ödenmiş siparişte ikinci tahsilat `PAYMENT_STATE_INVALID` döner.

## 4. Veri

- `meal_card_connections`: restoran + kuruluş kodu benzersiz; `acceptsOnline`, `acceptsOnDelivery`, şifreli bilgiler ve anahtar sürümü, durum, maskeli etiket, doğrulama zamanı.
- `orders.paymentMethod`, `orders.paymentProvider`: yerleştirme anındaki niyet. `payments`: olan biten (yöntem, kuruluş, durum, tutar, `providerRef`, `capturedAt`, `collectedByUserId`, mod).
- Katalog kodda (`MEAL_CARD_PROVIDERS`): kuruluş adı, ülke, API alanları. Alan adları her kuruluşun dokümanıyla kesinleşir; bugünkü değerler yer tutucudur.

## 5. Açık kararlar ve sıradakiler

- İlk gerçek adaptörler: pilot ilçedeki restoranların en çok kabul ettiği kartlara göre; her biri için restoranın kuruluşla çevrim içi ödeme sözleşmesi ve API erişimi gerekir. Sahip kararı.
- Kapıda nakit ve kart kabulü Faz 0'da her restoranda açıktır; restoran bazlı kapatma anahtarı panel ayarlarıyla (A3) gelir.
- İade: yemek kartı iadesi kuruluşun kurallarına bağlıdır (`refund` adaptörde ayrılmıştır); platform `REFUNDED` webhook'unu işler, iade başlatma A4 ile.
- Bakiye sorgulama ve kısmi yemek kartı + kart ödemesi (karma ödeme) bazı kuruluşlarda mümkündür; ilk adaptörle değerlendirilir.
