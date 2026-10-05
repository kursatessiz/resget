# Para akışı ve mutabakat

Tek sipariş için para izi her zaman şu sıradadır:

```
Müşteriden tahsil edilen -> KDV -> platform komisyonu -> PSP kesintisi -> tevkifat -> restoran hakedişi
```

Kural kodu `packages/shared/src/settlement.ts` (`computeOrderSettlement`), testleri `settlement.spec.ts` içindedir. Ödeme moduna göre sarmalayan `computeModeSettlement` (`payments.ts`) her çağrının giriş noktasıdır. API'de `SettlementService` restoranın sözleşme değerlerini ve modunu bağlar; `POST /restaurants/:id/orders/settlement-preview` sipariş yokken bile dökümü verir. Bu, restorana verilen şeffaflık sözünün ürünü halidir.

## Ödeme modunun etkisi (`docs/ODEME.md`)

| | `OWN_POS` | `PLATFORM_PSP` |
|---|---|---|
| PSP kesintisi | 0 (restoran kendi bankasıyla halleder) | restoranın sözleşme oranı |
| Tevkifat | 0 (platform ödeme yapmaz) | bölgesel varsayılan |
| Komisyon + KDV | `platformReceivableMinor`: ay sonu fatura | hakedişten düşülür |
| `payoutMinor` | 0 | restoran hakedişi |

Sipariş, yerleştirme anındaki modu ve tutarları anlık görüntü olarak taşır. Aylık komisyon faturası bu anlık görüntülerin toplamıdır; hiçbir zaman yeniden hesaplanmaz.

## Girdiler

| Alan | Kaynak |
|---|---|
| `items[]` (brüt, KDV oranı) | Sipariş kalemleri |
| `deliveryFee` | Restoranın teslimat ücreti politikası |
| `discount` ve kim finanse etti | Kampanya kuralı |
| `commissionBps` | `Restaurant.commissionBps` (varsayılan 100) |
| `commissionVatBps` | Bölgesel varsayılan (`settlementDefaultsFor`, TR: 2000) |
| `psp` (yüzde, sabit, kim öder) | `Restaurant.pspPercentBps`, `pspFixedMinor`; varsayılan ödeyen restoran |
| `withholdingBps` | Bölgesel varsayılan (TR: 100) |
| `courier` (maliyet, kim öder) | `DeliveryRequest` |

## Kurallar

1. **Komisyon** brüt kalem toplamının (restoranın finanse ettiği indirim düşülmüş) yüzdesidir. Platformun satıştan aldığı tek gelirdir. Komisyon üzerine fatura KDV'si eklenir ve aynı şekilde hakedişten düşülür. Komisyon yalnızca uygulama üzerinden verilen eve teslim ve gel al siparişlerinden alınır; masaya verilen restoran içi sipariş (`DINE_IN`, masa QR ve açık hesap) komisyonsuzdur (sahibin kararı, 5 Ekim 2026; `commissionBpsFor()`). Masa siparişinde PSP kesintisi ve tevkifat kendi kurallarıyla hesaplanmaya devam eder.
2. **PSP kesintisi** müşteriden tahsil edilen toplam üzerinden hesaplanır ve restorana gerçek oranıyla yansıtılır. Platform marj eklemez; hacim arttıkça düşen oran restorana geçer.
3. **Tevkifat** (Türkiye: e-ticaret aracılarının yüzde 1 gelir/kurumlar vergisi stopajı) KDV hariç satış bedeli üzerinden hesaplanır. Komisyon, banka kesintisi ve benzeri giderler matrahı düşürmez; restoranın finanse ettiği indirim düşürür. Tevkifat platform geliri değildir: restoran adına vergi dairesine aktarılır, defterde `WITHHOLDING_TAX` olarak ayrı durur ve restoran bunu beyanında mahsup eder.
4. **Kurye** ayrı hizmettir. Teslimat ücreti ve kurye maliyeti aynı tarafa akar: restoran taşıyorsa (kendi kuryesi veya kendi ödediği üçüncü taraf) ikisi de restoran defterindedir; platform taşıyorsa ücret platform geliri, maliyet platform gideridir. Hiçbir durumda komisyonun içine girmez.
5. **İndirim** restoran finanse ettiyse restoranın satış tutarını düşürür; platform finanse ettiyse müşteri az öder, restoran tam tutarı alır, farkı platform karşılar.
6. **Yuvarlama** yalnızca `bpsOf()` içinde, satır başına bir kez, yarım yukarı. Tek istisna kısmi iadenin komisyon payıdır: `shareOf()` aynı kuralla (yarım yukarı) ve sipariş başına birikimli hesaplanır (aşağıda "Kısmi iade"). Karışık KDV'li indirim kalemlere brüt oranında dağıtılır, kalan son kaleme yazılır.

## Kimlik denklemi

Her girdi için şu denklem sağlanır ve test edilir:

```
tahsilEdilen = restoranHakedişi + tevkifat + pspKesintisi + kuryeMaliyeti + platformNet + komisyonKdv
```

`platformNet` = komisyon + (platform taşıyorsa teslimat ücreti) - (platform ödüyorsa PSP) - (platform taşıyorsa kurye) - (platform finanse ettiyse indirim).

## Örnek

500 TL sipariş, yüzde 10 KDV, yüzde 1 komisyon, yüzde 2 PSP, Türkiye:

| Satır | Tutar |
|---|---|
| Satış tutarı | 500,00 TL |
| Platform komisyonu | -5,00 TL |
| Komisyon KDV (yüzde 20) | -1,00 TL |
| PSP kesintisi | -10,00 TL |
| Tevkifat (454,55 TL'nin yüzde 1'i) | -4,55 TL |
| Hakediş | 479,45 TL |

Platform geliri 5 TL, tevkifat ve KDV devlete, PSP kesintisi ödeme kuruluşuna.

## Defter ve hakediş ödemesi

- `LedgerEntry` yalnızca eklemelidir; düzeltme yeni satırdır (`ADJUSTMENT`, `REFUND`). Aylık komisyon faturası kesildiğinde `PLATFORM_COMMISSION` ve `COMMISSION_VAT` satırları `invoiceId` ile eksi işaretli yazılır; iptal ters `ADJUSTMENT` satırıdır (`docs/FATURALAMA.md`).
- `Order` yerleştirme anındaki dökümün anlık görüntüsünü taşır; sonradan oran değişse geçmiş siparişler değişmez.
- **Sipariş satırları**: `PLATFORM_PSP` ile tahsil edilen bir sipariş `DELIVERED` veya `PICKED_UP` olduğunda `LedgerService.recordOrderCompletion()` siparişin anlık görüntüsünden döküm satırlarını (`orderLedgerLines`, motorun ürettiğiyle aynı kurallar) bir kez yazar; satırlar `restaurantPayableMinor` ile tutmazsa fark `ADJUSTMENT` satırıyla kapatılır ve günlüğe yazılır. `OWN_POS` siparişi deftere girmez: para restoranın bankasındadır, komisyonu ay sonu faturası (`docs/FATURALAMA.md`) `invoiceId` ile kaydeder.
- **Haftalık hakediş**: günlük iş (`BillingService.runDaily` içinden `PayoutsService.rollDue`) kapanmış son Pazartesi-Pazartesi haftasının (UTC) `payoutId` boş `RESTAURANT_PAYABLE`, `REFUND` ve `ADJUSTMENT` satırlarını restoran ve para birimi başına tek `Payout` olarak toplar; `scheduledFor` hafta kapanışından ülkenin yasal süresi kadar iş günü sonradır (`PAYOUT_SETTLE_BUSINESS_DAYS_BY_COUNTRY`, Türkiye 5, varsayılan 7; resmî tatiller sonraki bölgesel adaptördür). Geç gelen satır bir sonraki haftaya biner; dönem başına ikinci ödeme açılmaz. Hakediş takvimi modülü açıksa restoran günlük takvimi seçebilir veya anında ödeme isteyebilir; ücret KDV dahil `PAYOUT_FEE` satırı olarak hakedişten düşülür ve ay sonu faturasında ayrı satırda görünür (`docs/HAKEDIS_TAKVIMI.md`). PSP'nin kendi valörü bu süreyi aşamaz; aşıyorsa platform ara finansman yapar veya PSP ile ertesi gün ödeme sözleşmesi şarttır.
- **Ödeme hareketi**: bugün banka transferidir; konsol (`/admin/hakedisler`, `GET /admin/payouts`, `POST /admin/payouts/run`, `POST /admin/payouts/:id/{sent,settled,failed}`) ödemeyi gönderildi, hesaba geçti veya başarısız olarak işaretler ve her adım denetim kaydıdır. Restoran `GET /restaurants/:id/finance/ledger` (`finance.view`) ile bekleyen hakedişini, satırlarını ve ödemelerini görür (`/panel/<slug>/finans`). Gerçek ödeme sağlayıcısı adaptörü B4'ün PSP sözleşmesiyle gelir.
- İade (`docs/ODEME.md` bölüm 3b): `Payment.refundedMinor` artar, defterde `REFUND` satırı ile komisyon iade satırları açılır (`recordRefund`, yalnızca `PLATFORM_PSP`, yalnızca siparişin `RESTAURANT_PAYABLE` satırı yazılmışsa, yani tamamlanmışsa, ve sipariş başına bir kez) ve bir sonraki hakedişe girer; `REFUND` iade edilen tutarın tamamıdır, komisyon ve KDV'si geri döner (yukarıda "İade ve chargeback"). Tamamlanmadan iade edilen siparişte restorana alacak yazılmadığı için düşülecek bir şey yoktur. PSP iade komisyonunu geri veriyorsa `PSP_FEE` düzeltmesi yazılır (PSP sözleşmesine bağlı).

## İade ve chargeback

Sahibin kararı (4 Ekim 2026): restoranla yapılan sözleşme gereği iade ve chargeback (ters ibraz) tutarı restorana yüklenir; bu işlemlerde platform komisyon almaz.

- **Tutar restorandan.** Müşteriye geri dönen para restoranın hakedişinden veya kendi tahsilatından çıkar; PSP kesintisi de restoranda kalır (PSP iade ettiğinde ayrıca `PSP_FEE` düzeltmesi yazılır).
- **Komisyon alınmaz.** Tamamlanmış siparişin iade edilen veya chargeback'e uğrayan kısmının komisyonu ve KDV'si restorana geri döner; her iade bir `OrderRefund` satırıdır ve geri verilen payı taşır (aşağıda "Kısmi iade"). Siparişin parası tamamen geri döndüğünde (son iade veya chargeback) sipariş `commissionReversedAt` ile damgalanır ve komisyonun tamamı geri dönmüş olur. Tamamlanmadan iptal edilen sipariş zaten komisyon doğurmaz.
- **`OWN_POS`**: fatura kesilmeden tamamen iade edilen (damgalanan) sipariş açık ayın faturasına hiç girmez ve iade satırları da mahsup edilmez. Faturaya giren siparişin (bu ayki veya kesilmiş bir faturadaki, `Order.commissionInvoiceId`) iade satırlarının komisyon payı faturada mahsup edilir (`OrderRefund.creditInvoiceId`, dökümde iade başına bir `credits` satırı, `refundId` ile). Mahsup iade satırı bazında, en eskiden başlayarak ve yalnızca toplamı o ayın komisyonunun altında kaldıkça uygulanır (`applyCommissionCredits`); fatura hiçbir zaman sıfır veya eksi olmaz, kalan mahsup sonraki faturayı bekler. Fatura kesildikten sonra döküm o faturanın faturaladığını ve mahsup ettiğini aynen gösterir. Bu düzenden önce tamamen iade edilmiş siparişler geçişte birer iade satırına çevrildi (`20261023000000_order_refunds`); önceki mahsup bilgisi korunur.
- **`PLATFORM_PSP` iadesi**: her iade, tutarı kadar `REFUND` satırıyla hakedişten düşer ve aynı anda `COMMISSION_REVERSAL` ile `COMMISSION_VAT_REVERSAL` satırları o iadenin komisyon ve KDV payını geri verir (`LedgerService.recordRefund`, `commissionReversalLines`); üçü de bir sonraki hakedişe girer (`PAYABLE_LINE_TYPES`). Tevkifat satırı yerinde kalır; satışın iptaline bağlı vergi düzeltmesi mali müşavirle ayrıca ele alınır.
- **`PLATFORM_PSP` chargeback'i**: PSP'nin chargeback bildirimi (`GatewayWebhookEvent.status = CHARGEBACK`) ödemeyi `CHARGED_BACK` yapar; tamamlanmış siparişte ödemenin kalan tutarı kadar `CHARGEBACK` satırı ve komisyonun o ana kadar geri dönmemiş kısmı kadar iade satırları yazılır. Ödeme başına bir kez; tamamen iade edilmiş ödemede yazılmaz. Chargeback'ten sonra gelen yakalama veya iade bildirimi bir şey değiştirmez; itirazı restoran kazanırsa platform `ADJUSTMENT` satırıyla geri verir. Her chargeback `payment.charged_back` denetim kaydıdır; PSP'nin chargeback ücreti PSP sözleşmesiyle `PSP_FEE` düzeltmesi olarak eklenir.
- **`OWN_POS` chargeback'i** restoranla kendi bankası arasındadır; platform bildirimi kaydeder (ödeme `CHARGED_BACK`) ve siparişi damgalar, komisyon yukarıdaki gibi alınmaz veya mahsup edilir.
- Panel raporlarındaki biriken komisyon, iade ve chargeback'lerle geri verilen payların düşülmüş halidir; tamamen iade edilenler zaten tamamlanmış sayılmaz.

## Kısmi iade

Sahibin kararı (4 Ekim 2026): restoran siparişin bir kısmını iade edebilir (seçilen ürünler veya bir tutar; müşterinin eksik ürün bildirimi restoran onaylayınca aynı yoldan iade olur, `docs/ODEME.md` "Eksik ürün bildirimi"). İade tutarı restorana aittir; platform komisyonunun iade edilen paya düşen kısmı restorana geri verilir.

- **Pay.** Bir iadenin geri verdiği komisyon `refundCommissionShare()` ile hesaplanır: komisyon x (iade tutarı / müşterinin ödediği tutar, `chargedToCustomerMinor`), KDV'si için aynısı. Hesap sipariş başına birikimlidir: n'inci iadenin payı, ilk n iadenin toplamına düşen pay eksi öncekilerin payıdır (`shareOf()`, yarım yukarı); böylece yuvarlama kaymaz ve bütün iadelerin payları siparişin komisyonuna eşit olur. Siparişin parasını bitiren son iade ve chargeback, komisyonun kalanını olduğu gibi verir.
- **Örnek.** Müşterinin ödediği 300,00, komisyon 3,00, KDV'si 0,60. Önce 100,00 iade: komisyon payı 1,00, KDV payı 0,20. Sonra 100,00 daha: birikimli 200,00'ün payı 2,00 / 0,40, bu iadeninki 1,00 / 0,20. Kalan 100,00 iade edilince kalan 1,00 / 0,20 döner ve sipariş `REFUNDED` olur.
- **Ürün iadesi tutarı.** Seçilen ürünlerin satır fiyatı (adet oranında) siparişteki indirim oranında küçültülür: müşterinin o ürünler için gerçekten ödediği tutar (`itemsRefundMinor()`). Teslimat ücreti ürün iadesine girmez; gerekiyorsa tutar olarak iade edilir. Bir ürünün iade edilen adedi siparişteki adedi geçemez.
- **Kayıt.** Her ödeme iadesi bir `OrderRefund` satırıdır (tutar, kaynak, ürünler, gerekçe, komisyon payı) ve ödemenin iade tutarıyla aynı işlemde yazılır. `OWN_POS`'ta pay faturada mahsup edilir (yukarıda), `PLATFORM_PSP`'de iadeyle aynı hakedişte döner.

## Yönteme göre hakediş modu

Hangi siparişin hangi modla hesaplanacağı ödeme yöntemine bağlıdır (`effectivePaymentModeFor`, `docs/YEMEK_KARTI.md`): yalnızca çevrim içi kart ödemesi restoranın `paymentMode`'unu izler. Nakit, kapıda kart ve yemek kartlarını restoran kendisi tahsil ettiği için bu siparişler `PLATFORM_PSP` restoranında bile `OWN_POS` gibi hesaplanır: PSP kesintisi ve tevkifat sıfır, komisyon + KDV ay sonu faturasına girer. Mod sipariş kaydında saklanır. Açık hesaba yazılan masa siparişleri (`docs/ACIK_HESAP.md`) de restoran tarafından tahsil edildiği için `OWN_POS` gibi hesaplanır; hesap payları siparişlere en eskiden başlayarak kasada tahsilat olarak yazılır.

## Bölgesel varsayılanlar

`SETTLEMENT_DEFAULTS_BY_COUNTRY`: TR için tevkifat 100 bps ve komisyon KDV'si 2000 bps; diğer ülkeler için her ikisi 0 (ülke eklenirken satır açılır). Hiçbir yerde `'TRY'` veya `'TR'` sabit yazılmaz; para birimi ve ülke restorandan gelir.
