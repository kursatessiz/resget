# Hakediş takvimi: haftalık, günlük, anında ve plana bağlı

Karar (sahip): hakediş ödemesi seçenekli olur. Dört seçeneğin hepsi vardır ve ücretleri platform verisidir. Hacim arttıkça PSP maliyeti düşeceği için ücretler değişebilir; kod değişmeden süper admin günceller. Ücret KDV dahildir, hakedişten düşülür ve ay sonu komisyon faturasına ayrı satır olarak girer (sahip kararı).

Yalnızca `PLATFORM_PSP` restoranlarını ilgilendirir: parayı platform tahsil eder ve hakediş olarak öder (`docs/MUTABAKAT.md`, "Defter ve hakediş ödemesi"). `OWN_POS` restoranında para zaten restoranın bankasındadır. Modül anahtarı `payout_schedules` (varsayılan kapalı). Kapalıyken herkes bugünkü gibi haftalık ve ücretsiz ödenir.

## Seçenekler

| Takvim | Ne zaman | Varsayılan |
|---|---|---|
| `WEEKLY` (haftalık) | Kapanan Pazartesi-Pazartesi haftası, ülkenin yasal süresi içinde (Türkiye 5 iş günü) | Ücretsiz, herkese açık |
| `DAILY` (günlük) | Kapanan UTC günü, seçeneğin iş günü kadar sonra (varsayılan 1) | Ücret platform verisi |
| `INSTANT` (anında) | Restoran istediği an bekleyen bakiyenin tamamını ister; ödeme aynı gün planlanır | Ücret platform verisi |
| Plana bağlı | Seçenek "hızlı hakediş" plan özelliği (`fast_payouts`) olan planlara ücretsiz verilebilir veya yalnızca onlara açılabilir | Plan matrisinden (`docs/PLAN_MATRISI.md`) |

Seçenekler `payout_schedule_options` tablosundadır; her satır bir takvim ve para birimi içindir.

- **Ücret**: oran (`feeBps`) ve sabit tutar (`feeFixedMinor`). Ücret, ödenecek tutarın oranı artı sabit tutardır ve hiçbir zaman ödenecek tutarı geçmez (`payoutFee()`, yuvarlama `bpsOf` içinde bir kez).
- **İş günü**: ödemenin dönem kapanışından kaç iş günü sonra planlanacağı (`settleBusinessDays`).
- **Plan şartları**:
  - `requiresFastPayouts`: yalnızca `fast_payouts` taşıyan planlara açıktır.
  - `freeWithFastPayouts`: `fast_payouts` taşıyan planlarda ücret sıfırdır.
- **Satışta mı**: `isActive`.

Bir para birimi için satır yoksa o takvim sunulmaz; haftalık için satır yoksa bugünkü kural geçerlidir (ülkenin yasal süresi, ücretsiz).

Süper admin seçenekleri `/admin/hakedisler` ekranındaki "Hakediş takvimi seçenekleri" kartından düzenler. Her değişiklik denetim kaydına yazılır.

## Restoran

Panelde `/finans` ekranında "Hakediş takvimi" kartı (`payments.manage`) şunları gösterir:

- restoranın para birimindeki seçenekleri, ücretlerini ve plan şartlarını;
- bekleyen bakiyeyi.

Restoran haftalık veya günlük takvimi seçer (`PUT /restaurants/:id/finance/payout-schedule`). Anında ödeme bir eylemdir (`POST /restaurants/:id/finance/payouts/instant`). Kart, isteğin ücretini ve net tutarı önceden gösterir (`GET .../payouts/instant/quote`). Ücret bakiyeyi aşıyorsa istek reddedilir (`PAYOUT_NOTHING_DUE`).

## Hakediş oluşumu

- **Günlük iş** (`BillingService.runDaily`):
  - Haftalık takvimdeki restoranlar için kapanan haftayı toplar.
  - Günlük takvimdeki restoranlar için kapanan günü toplar.
  - Her ikisi restoran, dönem ve para birimi başına bir kez çalışır (idempotent).
- **Anında**: restoran satırı kilitlenir (`SELECT ... FOR UPDATE`). Atanmamış bütün ödenecek satırlar o an toplanır, böylece aynı anda gelen iki istek aynı satırı iki kez ödeyemez.
- **Ücret satırı**: ücret, hakedişe `PAYOUT_FEE` defter satırı olarak eksi işaretle bağlanır. Hakediş tutarı satırların toplamından ücret düşülmüş haldir. Plan ücretsizse veya ücret sıfırsa satır yazılmaz.

## Fatura

Ay içinde yazılan `PAYOUT_FEE` satırları, o ayın komisyon faturasına "hızlı hakediş ücreti" satırı olarak girer:

- KDV dahil tutar, ülkenin komisyon KDV oranıyla net ve KDV olarak ayrılır (`netOfVat`).
- Faturanın toplamı bu satırı içerir. Ancak ücret hakedişten zaten düşüldüğü için tahsil edilecek tutar `totalMinor - deductedMinor` olur.
- Komisyonu olmayan ve yalnızca ücreti olan fatura kesildiği anda `PAID` olur (`paymentRef: payout-deduction`).
- Mali belge (e-Arşiv) iki satırı birlikte gösterir.

## Değişmeyen kurallar

- Ücret oranı, sabiti ve plan şartları veridir; kodda sabit ücret yoktur, para birimi satırdadır.
- Defter yalnızca eklemelidir. Ücret de bir satırdır.
- Yasal süre aşılmaz. Günlük ve anında ödemeler PSP valöründen önce planlanabilir; aradaki finansmanı platform üstlenir (ücretin gerekçesi).

## Testler

- `packages/shared/src/payout-schedules.spec.ts`: ücret, sınır, plan muafiyeti, günlük dönem.
- `apps/api/test/e2e/payout-schedules.e2e-spec.ts`: kapalı modül, seçenek yönetimi, takvim seçimi, günlük toplama ve ücret satırı, anında ödeme ve eşzamanlılık, plan muafiyeti, faturada ücret satırı ve tahsil tutarı.
- Playwright `payout-schedules.e2e.ts`.
