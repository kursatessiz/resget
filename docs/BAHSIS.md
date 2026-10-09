# Kurye bahşişi

Karar (sahip):

- Bahşiş yalnızca teslimattan sonra verilir. Restoranda (masada veya gel-al siparişinde) bahşiş yoktur.
- Platform bahşişten komisyon almaz. Bahşişten yalnızca onu tahsil eden ödeme sağlayıcısının gerçek kesintisi (PSP) düşer.
- Restoran kurye başına bahşiş raporunu görür.
- Siparişi üçüncü taraf bir kurye ağı taşıdıysa ve ağın API'si destekliyorsa bahşiş ağa aktarılır.

Modül anahtarı `courier_tips` (teslimat, varsayılan kapalı, BETA).

## Kim, ne zaman bahşiş verebilir

Siparişin müşterisi, takip sayfasından (`/t/<token>`) veya uygulamanın takip ekranından bahşiş verir. Uygulama aynı kartı gösterir; ödeme tarayıcıda hosted sayfada alınır, dönüş web takip sayfasınadır ve müşteri uygulamaya dönünce ekran yeniden okunur. Kart şu koşulların hepsi sağlanınca görünür (`tipOffer`):

- **Sipariş**: teslimat siparişidir (`DELIVERY`) ve durumu `DELIVERED`'dır.
- **Süre**: teslimden bu yana en fazla `TIP_WINDOW_DAYS` gün geçmiştir. Bu süre değerlendirme süresiyle aynıdır (7 gün).
- **Modül**: `courier_tips` restoran için açıktır.
- **Bahşişi alacak bir kurye vardır**:
  - Restoranın kendi kuryesi: siparişin teslim edilen durağının seferindeki kurye üyeliği.
  - Kurye ağı: adaptörü bahşiş aktarmayı destekleyen bir ağ (`CourierProviderAdapter.supportsTips`).
  - Bahşişi taşıyamayan ağda ve kuryesi bilinmeyen siparişte kart gösterilmez. Müşterinin parası hiçbir zaman sahipsiz kalmaz.
- **Çevrim içi ödeme mümkündür**: `OWN_POS`'ta restoranın aktif POS bağlantısı vardır, `PLATFORM_PSP`'de platformun üye işyeri kullanılır.
- **Daha önce bahşiş tahsil edilmemiştir**: siparişte en fazla bir bahşiş tahsil edilir. Yarıda kalan veya başarısız bir deneme yeniden başlatılabilir.

## Tutar

- **Öneriler**: sipariş tutarının yüzde 5, 10 ve 15'idir (`TIP_PRESET_BPS`, `tipPresets()`). Yuvarlama yalnızca `bpsOf` içinde bir kez yapılır. Öneriler sınırların içine çekilir ve aynı tutara düşenler tekilleştirilir.
- **Serbest tutar**: müşteri dilediği tutarı da yazabilir. Alt sınır bir ana birimdir (ondalık hane sayısı para biriminden, `minorDigitsOf`), üst sınır müşterinin siparişte ödediği tutardır (`chargedToCustomerMinor`, `tipLimits()`).
- **Para birimi**: sipariş para birimidir.
- **Siparişe etkisi**: bahşiş sipariş tutarına, KDV dökümüne, platform komisyonuna ve komisyon faturasına girmez. Siparişin ödeme durumunu (`paymentOf`) ve iadelerini etkilemez, çünkü kendi tablosunda (`courier_tips`) tutulur.

## Ödeme

Bahşiş, siparişin çevrim içi ödemesiyle aynı sağlayıcıdan hosted ödeme sayfasıyla alınır. Kart numarası platforma girmez.

- `POST /public/orders/:token/tip` (`{ amountMinor, returnUrl }`) bir `CourierTip` satırı açar veya yarıda kalanı günceller. Ardından hosted oturumu başlatır ve `redirectUrl` döner. Sağlayıcıya giden sipariş referansı bahşişin kimliğidir.
- **`OWN_POS`**: ödeme restoranın kendi POS'undan alınır. Bildirim, bağlantının mevcut webhook adresine gelir (`/webhooks/payments/pos/<connectionId>`).
- **`PLATFORM_PSP`**: ödeme platformun üye işyerinden alınır. Bildirim platformun webhook adresine gelir (`/webhooks/payments/platform/<providerCode>`). İmza, platformun ortamdaki üye işyeri bilgileriyle doğrulanır.
  - Bu adres, platformun tahsil ettiği sipariş ödemeleri için de kullanılır. Hosted oturum bu adresi bildirim adresi olarak gönderir; iyzico bu adres olmadan oturum açamaz.
- **Webhook**: önce referansın bir bahşiş olup olmadığına bakar.
  - **Tahsil edildi**: bahşiş `CAPTURED` olur. Kaydedilen tutar sağlayıcının tahsil ettiği tutardır; müşteri oturumu yeniden başlatıp tutarı değiştirmiş olabilir. Para birimi uyuşmazlığı 400 ile reddedilir. İki bildirim aynı anda gelse de bahşiş bir kez tahsil edilmiş sayılır.
  - **Başarısız**: `FAILED`.
  - **İade veya chargeback**: `REFUNDED` veya `CHARGED_BACK`. Tekrarlanan bildirim etkisizdir.
- **Kesinti**: PSP kesintisi sağlayıcının bildirdiği tutardır (`pspFeeMinor`). Kuryeye kalan net tutar `amountMinor - pspFeeMinor`'dur.

## Para nereye gider

Bahşiş kuryenindir. Platform onu taşımaz ve kendine pay ayırmaz. Parayı her durumda restoran alır ve kuryeye ulaştırır; kurye ağı söz konusuysa ağ kuryeye öder ve restorana yansıtır.

| Durum | Para | Defter | Kuryeye ulaşma |
|---|---|---|---|
| `OWN_POS`, kendi kurye | Restoranın POS hesabına | Yok | Restoran rapordaki net tutarı kuryesine öder |
| `PLATFORM_PSP`, kendi kurye | Platform tahsil eder | `COURIER_TIP` (+brüt) ve `COURIER_TIP_FEE` (-kesinti), ikisi de hakedişe girer | Net tutar sonraki hakedişle restorana gelir, restoran kuryesine öder |
| Kurye ağı (bahşiş destekli) | Yukarıdaki iki satırdan biri, moda göre | Moda göre | Tahsilattan hemen sonra net tutar ağın API'siyle aktarılır (`addTip`); ağ kuryeye öder ve restorana fatura eder |

- **Ağa aktarım**: sonucu bahşiş satırında tutulur (`passThroughStatus`: `SENT`, `FAILED`). Başarısız aktarım panelden yeniden denenebilir (`POST /restaurants/:id/tips/:tipId/pass-through`, `courier.manage`).
- **İade ve chargeback**: bunların bedelini restoran taşır (`docs/MUTABAKAT.md`, "İade ve chargeback"). `PLATFORM_PSP`'de bildirim gelince deftere brüt tutar kadar eksi `COURIER_TIP` satırı yazılır. PSP kesintisi geri gelmez.
- **Panelden iade** (sahibin kararı, 9 Ekim 2026): tahsil edilmiş (`CAPTURED`) bahşiş `/kurye` ekranındaki "Son bahşişler" listesinden gerekçeyle iade edilebilir (`POST /restaurants/:id/tips/:tipId/refund`, `orders.refund` izni). İade her zaman tutarın tamamıdır ve bahşişi tahsil eden bağlantı üzerinden yapılır: `OWN_POS`'ta restoranın POS'u, `PLATFORM_PSP`'de platformun hesabı. Aynı anda iki iade başlatılamaz (`refundRequestedAt` talebi; `REFUND_IN_PROGRESS`). Sağlayıcı kabul edince bahşiş `REFUNDED` olur; gerekçe, işlemi yapan kişi ve sağlayıcının iade referansı bahşiş satırında, ayrıca denetim kaydında tutulur. `PLATFORM_PSP`'de deftere brüt tutar kadar eksi `COURIER_TIP` satırı yazılır; PSP kesintisi geri gelmez. Sağlayıcı reddederse veya yanıt vermezse bahşiş `CAPTURED` kalır ve hata kodu döner (`REFUND_DECLINED`, `REFUND_PROVIDER_ERROR`, bağlantı yoksa `REFUND_UNAVAILABLE`). Kuryeye veya kurye ağına aktarılmış tutar platform tarafından geri alınmaz; bedeli restoran taşır ve ekran iade onayında bunu söyler. Sonradan gelen sağlayıcı iade bildirimi etkisizdir.
- **Sağlayıcı panelinden iade**: sağlayıcının kendi panelinden yapılan iade bildirimle yukarıdaki gibi işlenir.
- **Vergi**: bahşişin kuryeye ödenmesindeki vergi ve bordro yükümlülüğü restoranındır. Platform bahşiş için fatura kesmez.

## Bildirim

Kendi kuryeye, bahşiş tahsil edilince tutarıyla birlikte push bildirimi gider (`tip.received`).

## Rapor

Panelde `/kurye` ekranında "Bahşişler" kartı yer alır (`courier.manage`; `GET /restaurants/:id/tips?days=`). Kart seçilen son gün sayısı içinde şunları gösterir:

- **Kurye başına**: tahsil edilen bahşiş adedi, brüt, kesinti ve net.
- **Kurye ağı başına**: aynı toplamlar ve başarısız aktarım sayısı.
- **Son bahşişler**: listelenir; başarısız aktarımın yanında "Yeniden dene" düğmesi vardır.

Aralık tahsil anına (`capturedAt`) göredir. Varsayılan aralık son 30 gündür (`TIP_REPORT_DEFAULT_DAYS`).

Kendi kurye, uygulamanın kurye ekranında yalnızca kendi bahşişlerini görür ("Bahşişlerim"; `GET /restaurants/:id/tips/me`, `courier.deliver`): son 30 günün adedi, brüt, kesinti ve net toplamı ile son bahşişler. Başka bir kuryenin bahşişi bu uçta hiçbir zaman görünmez. Kart modül kapalıyken gösterilmez.

## Uçlar

| Uç | Yetki |
|---|---|
| `POST /public/orders/:token/tip` | Takip token'ı (hız sınırlı) |
| `GET /restaurants/:id/tips` | `courier.manage`, `@RequireFeature('courier_tips')` |
| `GET /restaurants/:id/tips/me` | `courier.deliver`, `@RequireFeature('courier_tips')` |
| `POST /restaurants/:id/tips/:tipId/pass-through` | `courier.manage`, `@RequireFeature('courier_tips')` |
| `POST /restaurants/:id/tips/:tipId/refund` | `orders.refund`, `@RequireFeature('courier_tips')` |
| `POST /webhooks/payments/platform/:providerCode` | İmza doğrulaması |

Hata kodları:

- `TIP_UNAVAILABLE`: bahşiş koşulları sağlanmıyor.
- `TIP_ALREADY_PAID`: siparişte tahsil edilmiş bahşiş var.
- `TIP_AMOUNT_INVALID`: tutar sınırların dışında.

## Kalan

- Gerçek kurye ağı adaptörlerinde bahşiş aktarımı: ağın API'si belgelendiğinde eklenir.
