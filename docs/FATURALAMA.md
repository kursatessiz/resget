# Komisyon faturalama ve tahsilat

`OWN_POS` modundaki restoran tahsilatı kendi hesabına alır; platformun yüzde 1 komisyonu ve KDV'si her tamamlanan siparişte yerleştirme anındaki anlık görüntü olarak birikir (`docs/MUTABAKAT.md`). Bu belge o birikimin faturaya dönüşmesini, tahsilatını ve gecikmede ne olduğunu tanımlar. Kod: `packages/shared/src/billing.ts` (kurallar ve sözleşmeler), `apps/api/src/modules/billing` (iş, uçlar, zamanlayıcı), `apps/web/src/components/panel/BillingPanel.tsx` ve `components/admin/AdminInvoices.tsx` (ekranlar).

## Günlük iş

API süreci içinde `BillingScheduler` her saat tetiklenir ve günde bir kez (UTC gün, Redis `billing:run:<tarih>` kilidi; Redis yoksa süreç içi işaret) `BillingService.runDaily()` çalıştırır. Aynı iş `node dist/cli/billing.js [--as-of=<ISO>]` ile cron'dan veya elle, konsoldan `POST /admin/billing/run` ile çalıştırılabilir; `BILLING_SCHEDULER=off` süreç içi zamanlayıcıyı kapatır. Her adım idempotenttir, iki kez çalışmak sorgu maliyetidir, para hatası değildir.

1. **Kesim**: bir önceki UTC takvim ayı için faturası olmayan her aktif restoranın dökümü (`buildCommissionStatement`, `GET .../payments/commission` ile aynı) alınır; iade edilen veya chargeback'e uğrayan kısmın komisyonu alınmaz: fatura kesilmeden tamamen iade edilen sipariş dökümden çıkar, faturaya giren siparişin her iadesinin komisyon payı mahsup edilir (`credits`, iade başına bir satır; mahsup faturayı sıfıra veya eksiye düşürmez, kalan sonraki faturaya devreder). Kesim, faturaladığı siparişleri (`Order.commissionInvoiceId`) ve mahsup ettiği iadeleri (`OrderRefund.creditInvoiceId`) işaretler; `docs/MUTABAKAT.md` "İade ve chargeback". Ay içinde hakedişten düşülen hızlı hakediş ücretleri (`PAYOUT_FEE`, `docs/HAKEDIS_TAKVIMI.md`) faturaya KDV'si ayrılmış ayrı bir satır olarak eklenir; bu kısım zaten tahsil edildiği için `deductedMinor` olarak işaretlenir ve tahsil edilecek tutardan düşülür. Komisyonu ve hakediş ücreti sıfır olan restoran için fatura yazılmaz; yalnızca ücret satırı olan fatura kesildiği anda ödenmiş sayılır. Diğerleri için `CommissionInvoice` `ISSUED` olarak açılır (`issuedAt` şimdi, `dueAt` kesimden `COMMISSION_INVOICE_DUE_DAYS` = 10 gün sonra), deftere restoran bakış açısıyla eksi işaretli `PLATFORM_COMMISSION` ve `COMMISSION_VAT` satırları yazılır (`invoiceId` ile), sahibin telefonuna `invoice.issued` mesajı gider (platform trafiği, kredi düşmez). `(restaurantId, periodStart)` tekil indeksi çift kesimi engeller.
2. **Mali belge**: `fiscalRef`'i olmayan faturalar için `InvoiceProviderAdapter.issue()` çağrılır (e-Arşiv entegratörü; bugün `MOCK`, `INVOICE_PROVIDER` ile seçilir). Başarısız çağrı ertesi gün yeniden denenir; fatura numarası fatura başına bir kezdir.
3. **Tahsilat**: tahsilat kartı tanımlı restoranların açık (`ISSUED` veya `OVERDUE`) faturaları kart kasasından çekilir (`CardVaultAdapter.charge`, `merchantRef: 'platform'`). Başarılıysa fatura `PAID`, `paymentRef` kasa referansı. Başarısızsa deneme sayısı, zamanı ve nedeni faturaya yazılır; en erken 20 saat sonra, en çok 5 kez yeniden denenir (`collectionIsDue`). Üç boyutlu doğrulama isteyen kart gözetimsiz çekilemez; hata `REQUIRES_3DS` olarak kalır ve sahip panelden "Şimdi öde" ile tamamlar. İşletme devredildiğinde önceki sahibe ait tahsilat kartı ayrılır; yeni sahip kendi kartını ekleyene kadar fatura havaleyle veya "şimdi öde" ile kapanır (`docs/PERSONEL.md`).
4. **Gecikme**: vadesi geçmiş `ISSUED` faturalar `OVERDUE` olur. Restoranın `listingSuspendedAt` alanı doldurulur (zaten doluysa dokunulmaz), denetim kaydı yazılır (`restaurant.listing_suspended`) ve sahibe `invoice.overdue` mesajı gider. Askıdaki restoran pazaryeri listesinde görünmez (`GET /public/marketplace` `listingSuspendedAt: null` filtreler); masa QR, kendi sipariş sayfası, panel ve bildirimler çalışmaya devam eder. Askı, sahibin kendi müşterisine hizmet vermesini asla engellemez.
5. **Geri açılış**: fatura ödenince (kart, konsoldan havale veya iptal) restoranın `OVERDUE` faturası kalmadıysa `listingSuspendedAt` temizlenir (`restaurant.listing_reinstated`). Konsol onayı (`isListed`) ayrı bir karardır ve askıdan etkilenmez.

## Restoran paneli (`/panel/<slug>/finans`, izin `invoices.view`)

- `GET /restaurants/:id/billing`: son 36 fatura, tahsilat kartı, askı durumu, açık fatura toplamı, vade kuralı.
- `PUT /restaurants/:id/billing/card` (`payments.manage`): tahsilat kartı; yalnızca çağıranın kendi kasa kartı seçilebilir, `null` kaldırır. Kart bağlama akışı Plan ve krediler sayfasındadır (`docs/ODEME.md` 3).
- `POST /restaurants/:id/billing/invoices/:invoiceId/pay` (`payments.manage`): açık faturayı çağıranın bir kartıyla veya tahsilat kartıyla şimdi öder; `REQUIRES_3DS` dönerse `redirectUrl` bankaya götürür.
- Ekran ayrıca bu ay biriken komisyonu (`GET .../payments/commission`) gösterir.

## Konsol (`/admin/faturalar`, `@SuperAdminOnly()`)

- `GET /admin/billing/invoices?status&restaurantId&page&pageSize`: tüm faturalar.
- `POST /admin/billing/run` (`asOf` isteğe bağlı): günlük işi şimdi çalıştırır ve raporu döner (kesilen, atlanan, mali belge, tahsil edilen, başarısız, geciken, askıya alınan).
- `POST /admin/billing/invoices/:id/mark-paid` (`paymentRef`): havaleyle ödenen faturayı kapatır (`paymentRef: transfer:<dekont>`).
- `POST /admin/billing/invoices/:id/void`: ödenmemiş faturayı iptal eder; deftere ters `ADJUSTMENT` satırı yazar, mali belgeyi iptal ettirir, askıyı kaldırır. Ödenmiş fatura iptal edilemez (`INVOICE_STATE_INVALID`).
- `POST /admin/billing/invoices/:id/collect`: tahsilat kartından bir deneme daha.
- Her yazma `audit_logs` tablosuna gider.

## Değişmeyen kurallar

- Fatura tutarı siparişlerin anlık görüntülerinin toplamıdır, hiçbir zaman yeniden hesaplanmaz; oran değişikliği geçmiş ayı değiştirmez.
- Para tam sayı minör birim ve restoranın para birimidir; kodda para birimi sabiti yoktur.
- Kart numarası platforma girmez; tahsilat kasa token'ıyla yapılır, token şifreli durur.
- Askı yalnızca pazaryeri görünürlüğünü etkiler. Panel, masa QR ve kendi sipariş sayfası kapanmaz.
- Defter yalnızca eklemelidir: iptal yeni satırdır.

## Kalan

- Gerçek e-Arşiv entegratörü adaptörü (sözleşme gerekir) ve müşteri tarafı belge indirme bağlantısı (`fiscalDocumentUrl`).
- Üç boyutlu doğrulama dönüşünün panelde tamamlanması gerçek kasa adaptörüyle gelir (bugün MOCK anında çeker).
- Havale için sanal IBAN eşleştirme; bugün konsoldan elle kapatılır.
- Aylık özet e-postası (A7 e-posta kanalı açılınca).
