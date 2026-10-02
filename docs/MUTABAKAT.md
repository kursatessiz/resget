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

1. **Komisyon** brüt kalem toplamının (restoranın finanse ettiği indirim düşülmüş) yüzdesidir. Platformun satıştan aldığı tek gelirdir. Komisyon üzerine fatura KDV'si eklenir ve aynı şekilde hakedişten düşülür.
2. **PSP kesintisi** müşteriden tahsil edilen toplam üzerinden hesaplanır ve restorana gerçek oranıyla yansıtılır. Platform marj eklemez; hacim arttıkça düşen oran restorana geçer.
3. **Tevkifat** (Türkiye: e-ticaret aracılarının yüzde 1 gelir/kurumlar vergisi stopajı) KDV hariç satış bedeli üzerinden hesaplanır. Komisyon, banka kesintisi ve benzeri giderler matrahı düşürmez; restoranın finanse ettiği indirim düşürür. Tevkifat platform geliri değildir: restoran adına vergi dairesine aktarılır, defterde `WITHHOLDING_TAX` olarak ayrı durur ve restoran bunu beyanında mahsup eder.
4. **Kurye** ayrı hizmettir. Teslimat ücreti ve kurye maliyeti aynı tarafa akar: restoran taşıyorsa (kendi kuryesi veya kendi ödediği üçüncü taraf) ikisi de restoran defterindedir; platform taşıyorsa ücret platform geliri, maliyet platform gideridir. Hiçbir durumda komisyonun içine girmez.
5. **İndirim** restoran finanse ettiyse restoranın satış tutarını düşürür; platform finanse ettiyse müşteri az öder, restoran tam tutarı alır, farkı platform karşılar.
6. **Yuvarlama** yalnızca `bpsOf()` içinde, satır başına bir kez, yarım yukarı. Karışık KDV'li indirim kalemlere brüt oranında dağıtılır, kalan son kaleme yazılır.

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

- `LedgerEntry` yalnızca eklemelidir; düzeltme yeni satırdır (`ADJUSTMENT`, `REFUND`).
- `Order` yerleştirme anındaki dökümün anlık görüntüsünü taşır; sonradan oran değişse geçmiş siparişler değişmez.
- `Payout`, biriken `RESTAURANT_PAYABLE` satırlarını dönem bazında toplar ve yasal sürede (Türkiye: 5 iş günü) planlanır. PSP'nin kendi valörü bu süreyi aşamaz; aşıyorsa platform ara finansman yapar veya PSP ile ertesi gün ödeme sözleşmesi şarttır.
- İade: `Payment.refundedMinor` artar, defterde `REFUND` satırı açılır; PSP iade komisyonunu geri veriyorsa `PSP_FEE` düzeltmesi yazılır (PSP sözleşmesine bağlı).

## Bölgesel varsayılanlar

`SETTLEMENT_DEFAULTS_BY_COUNTRY`: TR için tevkifat 100 bps ve komisyon KDV'si 2000 bps; diğer ülkeler için her ikisi 0 (ülke eklenirken satır açılır). Hiçbir yerde `'TRY'` veya `'TR'` sabit yazılmaz; para birimi ve ülke restorandan gelir.
