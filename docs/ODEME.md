# Ödeme: iki mod, tek kart kasası

Karar (Ekim 2026): restoran varsayılan olarak kendi sanal POS'unu platforma bağlar ve tahsilat doğrudan kendi hesabına gelir; platform komisyonunu ay sonunda fatura eder. İsteyen restoran için platformun kendi PSP'si de vardır. Müşterinin kartı her iki modda da bir kart kasasında (vault) saklanır; platform kart numarasını hiçbir zaman görmez.

Kural kodu `packages/shared/src/payments.ts`, API tarafı `apps/api/src/modules/payments`.

## 1. Ödeme modları

| | `OWN_POS` (varsayılan) | `PLATFORM_PSP` |
|---|---|---|
| Tahsil eden | Restoranın kendi sanal POS'u, restoranın banka hesabına | Platformun PSP'si (pazaryeri / alt üye işyeri ürünü) |
| Platformun parayla teması | Yok | Var |
| Komisyon | Ay sonu fatura: yüzde 1 + KDV, restoranın kayıtlı kartından veya otomatik ödeme talimatından tahsil | Hakedişten düşülür |
| PSP kesintisi | Restoranla bankası arasında; platform görmez | Belgelenen gerçek oranla hakedişten düşülür |
| E-ticaret tevkifatı | Platform ödeme yapmadığı için platform kesmez (vergi danışmanı teyidi bekleniyor) | Platform keser ve beyan eder |
| Hakediş ödemesi | Yok | Yasal sürede (Türkiye: 5 iş günü) |
| Chargeback ve iade | Restoranda | Platform üzerinden, restorana yansıtılır |
| Lisans ve koruma hesabı | Gerekmez | PSP'nin pazaryeri ürünü üzerinden |
| Faz | Faz 0 | Faz 1 |

Restoranın modu `Restaurant.paymentMode` alanıdır; `OWN_POS`'a geçmek için aktif bir POS bağlantısı gerekir (`PAYMENT_CONNECTION_REQUIRED`). Her sipariş yerleştirme anındaki modu ve komisyonu üzerinde taşır (`Order.paymentMode`, `Order.platformReceivableMinor`); sonradan mod değişse geçmiş siparişler değişmez.

Hakediş motoru her iki modda aynıdır (`computeModeSettlement`): `OWN_POS` modunda PSP kesintisi ve tevkifat sıfır girilir, komisyon + KDV `platformReceivableMinor` olarak restoranın borcu olur, `payoutMinor` sıfırdır. `PLATFORM_PSP` modunda tam motor çalışır, `payoutMinor` restoran hakedişidir.

## 2. Kendi sanal POS bağlantısı

- Restoran panelden sağlayıcısını seçer ve POS bilgilerini girer (`PUT /restaurants/:id/payments/connection`, izin `payments.manage`). Desteklenen sağlayıcılar ve alanları `OWN_POS_PROVIDERS` içindedir; yeni sağlayıcı yeni bir `PaymentGatewayAdapter` ve bu listeye bir satırdır.
- API bilgileri sağlayıcıda doğrular (`verifyCredentials`), AES-256-GCM ile şifreler ve `PaymentProviderConnection` tablosuna yazar. Şifresiz hali hiçbir loga ve hiçbir yanıta girmez; panel yalnızca maskeli etiketi görür ("PAYTR ****1234").
- Şifreleme anahtarı `CREDENTIAL_ENCRYPTION_KEY` (32 bayt, base64) ile gelir; üretimde zorunludur. Şifreli metin anahtar sürümünü taşır (`keyVersion`), böylece anahtar döndürülebilir. Üretim hedefi zarf şifreleme (envelope encryption): veri anahtarı yerelde üretilir, Google Cloud KMS veya AWS KMS ile sarılır; `KeyProvider` arayüzü bunun için ayrılmıştır, `EnvKeyProvider` geliştirme uygulamasıdır.
- Ödeme akışı: müşteri siparişi onaylar -> API restoranın POS'unda hosted ödeme sayfası veya iframe oturumu açar (`createHostedCheckout`) -> müşteri kartı sağlayıcının sayfasında girer, 3-D Secure orada tamamlanır -> sağlayıcının webhook'u imzası doğrulanarak işlenir (`parseWebhook`) -> sipariş `PLACED` olur ve komisyon tahakkuk eder.
- Kart verisi platform sunucusuna hiçbir adımda değmez. PCI DSS kapsamı en hafif düzeyde (SAQ A) kalır. Bu, iki modda da değişmez bir kuraldır.

### Gerçek adaptörler (`apps/api/src/modules/payments/gateways`)

- **iyzico** (`IYZICO`; alanlar `apiKey`, `secretKey`, isteğe bağlı `baseUrl` ile sandbox): checkout form. İstekler IYZWSv2 imzasıyla gider (HMAC-SHA256, rastgele anahtar + yol + gövde). `createHostedCheckout` formu başlatır ve `paymentPageUrl` döner; `callbackUrl` bağlantının webhook adresidir (`PUBLIC_API_URL/webhooks/payments/pos/<connectionId>?return=<sipariş sayfası>`). Sonuç iki yoldan gelir: müşterinin tarayıcısı formun `token` değeriyle buraya POST eder (API ödemeyi iyzico'dan okur, sonra tarayıcıyı `return` adresine 303 ile yollar) ve iyzico'nun üye işyeri bildirimi (JSON, `x-iyz-signature-v3` başlığı; imza doğrulanır). İkisi de yalnızca tetikleyicidir: tutar, durum, `paymentTransactionId` ve iyzico komisyonu (`pspFeeMinor`) her zaman iyzico'dan geri okunur (`checkoutform/auth/ecom/detail` veya `payment/detail`). İade `payment/refund` ile işlem kimliği üzerinden yapılır. Kimlik doğrulaması `bin/check` çağrısıyladır. Üye işyeri bildirim adresi iyzico panelinde bağlantının webhook adresine ayarlanır.
- **PayTR** (`PAYTR`; alanlar `merchantId`, `merchantKey`, `merchantSalt`): iframe API. `get-token` isteği belgelenen sırayla HMAC-SHA256 (base64) ile imzalanır; `merchant_oid` sipariş kimliğinin tiresiz halidir (PayTR yalnızca harf ve rakam kabul eder) ve geri dönüşte tireler yeniden takılır. Tutarlar kuruş cinsinden tam sayı, para birimi PayTR'nin kendi kodlarıyla (`TL`, `EUR`, `USD`, `GBP`, `RUB`); desteklenmeyen para birimi reddedilir. Bildirim adresi PayTR panelinde bağlantının webhook adresine ayarlanır (adres panelde ödeme ekranında, bağlantı kartında gösterilir); gelen çağrının `hash` değeri (`merchant_oid` + `merchant_salt` + `status` + `total_amount`) doğrulanır ve uç nokta PayTR'nin beklediği düz metin `OK` ile yanıt verir (başka her yanıtta PayTR tekrar dener). İade `odeme/iade` ile yapılır. Kimlik doğrulaması `test_mode=1` ile 1 TL'lik bir token isteğidir; PayTR'nin ayrı bir doğrulama ucu yoktur.
- **Platformun üye işyeri** (`PLATFORM_PSP`): hosted oturum bildirim adresi olarak `PUBLIC_API_URL/webhooks/payments/platform/<PAYMENT_PROVIDER>` gönderir; imza platformun ortamdaki bilgileriyle doğrulanır ve yalnızca ortamın seçtiği sağlayıcı kodu kabul edilir (üretimde `MOCK` reddedilir). Bildirim önce kurye bahşişine mi ait diye bakılır (`docs/BAHSIS.md`), değilse siparişin `PLATFORM_PSP` çevrim içi ödemesine işlenir.
- `MOCK` geliştirme ve testlerde kalır. Param ve Sipay aynı arayüzle eklenir. Webhook uç noktası adaptörün verdiği cevabı (`ack`) ve tarayıcı yönlendirmesini (`browserRedirectUrl`) uygular; tutar uyuşmazlığı her sağlayıcıda 400 ile reddedilir. İstek ve yanıt biçimleri `gateways.spec.ts` ile sabitlenmiştir; canlı doğrulama sağlayıcının sandbox hesabıyla yapılır.

## 3. Kart kasası (card vault)

Hedef: müşteri kartını bir kez kaydeder, hangi restorandan sipariş verirse versin kullanır. Bunun için kartı saklayan taraf platform değil, bir kasa sağlayıcısıdır; platform yalnızca sağlayıcının token'ını şifreli tutar (`SavedPaymentMethod.encryptedToken`), kart markası ve son dört hane dışında hiçbir kart bilgisi yoktur.

| Kasa | Restoranlar arası kullanım | Not |
|---|---|---|
| **Masterpass** | Evet | Türkiye'de en yaygın kart saklama ağı. Müşteri telefon numarası ve OTP ile bağlanır; aynı Masterpass hesabı Masterpass üyesi her POS'ta çalışır. `OWN_POS` modunda restoranların POS'larının Masterpass entegrasyonu olması gerekir; büyük sağlayıcıların hepsinde var. Faz 0 hedefi. |
| **bex** (BKM) | Evet | BKM Express'in 15 Eylül 2026'da yenilenen hali: kartlar telefon numarasıyla eşlenir, bex üyesi her işyerinde kullanılır; Türkiye'deki banka, kredi ve ön ödemeli kartların tümü eklenebilir. Üye işyeri SDK'ları ve ortak ödeme sayfası entegrasyonları mevcut. Masterpass'in yanında ikinci restoranlar arası kasa; aynı `CardVaultAdapter` arayüzüyle eklenir. |
| **PSP token'ı** | Yalnızca `PLATFORM_PSP` içinde | iyzico `cardUserKey`, PayTR kart saklama. Tek üye işyeri olduğu için tüm platform restoranlarında geçerli, restoranın kendi POS'unda geçersiz. |
| **Google Pay / Apple Pay** | Evet | Cihaz cüzdanı ödeme token'ı üretir, gateway üzerinden işlenir. Mobil uygulamayla (Faz 1). |

Hangi kasanın önce bağlanacağı, pilot ilçedeki restoranların POS sağlayıcılarının hangi cüzdanı desteklediğine göre karar verilir; iki kasa aynı anda da açık olabilir, müşteri kartını bağladığı kasayla öder.

Kart numarasını kendi veritabanımızda KMS ile şifreleyip saklamak bilinçli olarak reddedilmiştir: platformu tam PCI DSS kapsamına (SAQ D, yıllık denetim, ağ segmentasyonu) sokar ve bir sızıntıda kart verisi doğrudan bizim sorumluluğumuz olur. KMS burada kart için değil, POS bilgileri ve kasa token'ları için kullanılır.

Arayüz `CardVaultAdapter`: `beginLink` (kasa kendi arayüzünde bağlama başlatır), `completeLink` (geri dönüşte token ve maskeli kart bilgisi), `charge` (token ile çekim; 3-D Secure gerekiyorsa yönlendirme), `forget`. Geliştirmede `MOCK`, üretimde `CARD_VAULT_PROVIDER=MASTERPASS` (MOCK üretimde reddedilir).

Müşteri uçları: `GET /me/payment-methods`, `POST /me/payment-methods/link`, `POST /me/payment-methods/link/complete`, `DELETE /me/payment-methods/:id`. Token asla yanıtta yoktur.

Platform cüzdanları (Masterpass, bex) ile sipariş ödemesi `docs/CUZDAN.md` içindedir. Cüzdanlar `PaymentsRegistry.wallets` altında kod başına bir adaptördür. Kayıtlı kartın çekimi ve silinmesi kartın geldiği kasanın adaptörüyle yapılır (`vaultFor`). Cüzdan çekimi platformun üye işyerine gittiği için yalnızca `PLATFORM_PSP` restoranlarında sunulur.

## 3a. Yemek kartları

Yemek kartlarında üye işyeri her zaman restorandır; restoran kabul ettiği kartları seçer, çevrim içi ödeme için kuruluşun API bilgilerini bağlar (POS bağlantısıyla aynı şifreleme ve doğrulama), kapıda kabul için yalnızca işaretler. Yemek kartı, nakit ve kapıda kart ödemeleri restoranın `paymentMode`'undan bağımsız olarak `OWN_POS` gibi hesaplanır (komisyon faturalanır, PSP ve tevkifat sıfır). Ödeme adımı (hosted oturum, imzalı webhook, kapıda tahsilat) ve uçlar: `docs/YEMEK_KARTI.md`.

## 3b. İade

Para her zaman geldiği yoldan geri döner (`RefundsService`, kurallar `packages/shared/src/refunds.ts`):

- **Çevrim içi ödeme** (kart veya çevrim içi yemek kartı) onu tahsil eden bağlantı üzerinden iade edilir: `OWN_POS`'ta restoranın kendi POS bağlantısının, yemek kartında kuruluş hesabının bilgileriyle (bağlantı sonradan pasife alınmış olsa bile bilgiler duruyorsa), `PLATFORM_PSP`'de platformun kendi üye işyeriyle. Adaptörün `refund(credentials, providerRef, amountMinor)` çağrısı kullanılır; iyzico'da `providerRef` ödeme işlem kimliği, PayTR'de `merchant_oid`'dir. Bağlantı yoksa `REFUND_UNAVAILABLE`: iade sağlayıcının panelinden yapılır.
- **Kapıda alınan para** (nakit, kapıda kart, kapıda yemek kartı) restoranın kasasındadır; personel tutarı müşteriye elden verdikten sonra iadeyi onaylar, platform yalnızca kaydeder. Bu ödemeler asla kendiliğinden iade edilmez.
- **İptalde otomatik iade**: `REJECTED`, `CANCELLED_BY_RESTAURANT` veya `CANCELLED_BY_CUSTOMER` geçişi işlendikten hemen sonra yakalanmış çevrim içi ödeme iade edilir. Başarısız deneme iptali geri almaz; ödeme `refundFailureCode` ile işaretlenir (`REFUND_DECLINED`, `REFUND_PROVIDER_ERROR`, `REFUND_UNAVAILABLE`), panelde görünür ve API içindeki tarama (dakikada bir, `REFUND_RETRY=off` ile kapanır) 5, 15, 60 ve 240 dakika arayla yeniden dener; son denemeden sonra karar personelindir. Müşteri iptal mesajının içinde ödemesinin iade edildiğini veya edileceğini okur; ayrı mesaj yoktur.
- **Tamamlanmış siparişte iade** yalnızca personel isteğiyle olur: `POST /restaurants/:id/orders/:orderId/refund` (`orders.refund`, gövde `{ reason }`, gerekçe zorunlu). Müşteriye `order.refunded` mesajı gider. Gövdeye `items` veya `amountMinor` eklenirse kısmi iadedir (aşağıda).
- **Tek seferde bir deneme**: her ödeme ağ geçidi çağrısından önce atomik olarak sahiplenilir (`refundRequestedAt`); iki ekran veya tarama aynı ödemeyi iki kez iade edemez. Yanıt vermeden kalan bir sahiplenme 5 dakika sonra bırakılır; sağlayıcılar zaten iade edilmiş işlemi reddeder.
- Gövdesiz (yalnızca gerekçeli) iade siparişin kalan parasının tamamıdır. Siparişin yakalanmış parası kalmadığında sipariş `REFUNDED` olur; bu durum yalnızca iade ucu veya sağlayıcının iade bildirimiyle gelir, çıplak durum geçişiyle (`/transition`) gelmez (`REFUND_NOT_ALLOWED`).
- Sağlayıcının kendi panelinden yapılan iade, imzalı `REFUNDED` bildirimiyle aynı şekilde kapanır; tekrarlanan bildirim etkisizdir, iadeden sonra gelen geç bir yakalama bildirimi yok sayılır.
- Defter: `PLATFORM_PSP` ile tahsil edilmiş ve tamamlanmış siparişin iadesi bir sonraki hakedişten düşer, komisyonu aynı hakedişte geri döner (`docs/MUTABAKAT.md`); tamamlanmadan iade edilen sipariş restorana hiç alacak yazmadığı için defterde iz bırakmaz. İade ve chargeback tutarı sözleşme gereği restorana aittir ve bu işlemlerde platform komisyon almaz: `OWN_POS`'ta iade edilen sipariş açık ayın faturasına girmez, kesilmiş faturadaysa sonraki faturada mahsup edilir; `PLATFORM_PSP`'de komisyon ve KDV'si iadeyle aynı hakedişte geri verilir (`docs/MUTABAKAT.md`, "İade ve chargeback").

### Kısmi iade

Tamamlanmış (`DELIVERED`, `PICKED_UP`) siparişin bir kısmı iade edilebilir; iptal edilmiş sipariş her zaman tamamen iade edilir.

- Gövde: `{ reason, items: [{ orderItemId, quantity }] }` (seçilen ürünler; tutar, müşterinin o ürünler için ödediğidir, `itemsRefundMinor()`) veya `{ reason, amountMinor }` (serbest tutar, örneğin teslimat ücreti veya gönül alma). İkisi birlikte gönderilemez.
- Hata kodları: `REFUND_NOT_ALLOWED` (sipariş tamamlanmamış veya iade edilecek para yok), `REFUND_ITEMS_INVALID` (ürün siparişte yok veya o adet zaten iade edildi), `REFUND_AMOUNT_TOO_HIGH` (kalan tutardan fazla), `REFUND_IN_PROGRESS`.
- Tutar önce çevrim içi ödemelerden (parayı tahsil eden bağlantı üzerinden, `refund(credentials, providerRef, amountMinor)` kısmi tutarla), sonra kapıda alınan ödemelerden (elden iade kaydı) düşülür (`allocateRefund()`). Ödeme `PARTIALLY_REFUNDED` olur; kalan tutar sıfırlanınca `REFUNDED`.
- Sipariş tamamlanmış kalır; parası tamamen geri döndüğünde `REFUNDED` olur ve müşteriye `order.refunded` gider. Aradaki her kısmi iadede müşteriye tutarıyla `order.partiallyRefunded` gider.
- Başarısız kısmi iade ekranda hata olarak döner ve otomatik yeniden denemeye girmez (otomatik deneme yalnızca iptal edilen siparişin tamamı içindir); ödeme işaretlenmez, personel yeniden dener. Birden çok ödemeye bölünen iadede ilk ödeme gitmiş, ikincisi başarısız olmuşsa giden kısım kayıtlıdır, kalanı yeniden denenir.
- Her ödeme iadesi bir `OrderRefund` satırıdır; sipariş ayrıntısı iadeleri (`refunds`: tutar, kaynak, ürünler, gerekçe, geri verilen komisyon) ve ürün başına iade edilen adedi (`items[].refundedQuantity`) gösterir. Komisyonun iade payı ve faturaya yansıması: `docs/MUTABAKAT.md`, "Kısmi iade".

### Eksik ürün bildirimi

Müşteri, tamamlanmış siparişte gelmeyen ürünü takip sayfasından (web `/t/<token>` ve uygulamadaki takip ekranı) bildirir; restoran onaylarsa tutar kısmi iade olarak geri döner. Kurallar `packages/shared/src/claims.ts`, uygulama `apps/api/src/modules/payments/claims.service.ts` içindedir.

- **Bildirim**: `POST /public/orders/:token/claims` gövde `{ items: [{ orderItemId, quantity }], note? }` (takip token'ı kimlik yerine geçer, değerlendirme gibi; anonim yazmalar gibi oran sınırlı). Sipariş tamamlanmış (`DELIVERED`, `PICKED_UP`), tamamlanmanın üzerinden en fazla `CLAIM_WINDOW_HOURS` (24) saat geçmiş, bekleyen başka bildirim yok ve iade edilecek para kalmış olmalıdır (`canFileClaim`); aksi `CLAIM_NOT_ALLOWED`. Ürün başına en fazla siparişteki adet eksi daha önce iade edilen adet bildirilir (`CLAIM_ITEMS_INVALID`). Bildirimin tutarı (`requestedMinor`) kısmi iadeyle aynı hesaptır: müşterinin o ürünler için ödediği.
- **Restorana uyarı**: `orders.refund` iznine sahip personelin telefonuna `order.claimFiled` push'u gider (ücretsiz); panel olay akışıyla güncellenir, sipariş kartında "Eksik ürün bildirimi" rozeti ve "Bildirimi incele" düğmesi çıkar (`OrderSummaryDTO.openClaimId`).
- **Onay**: `POST /restaurants/:id/orders/:orderId/claims/:claimId/approve` (`orders.refund`), gövde boş (bildirilenin tamamı) veya `{ items }` (bildirilenin bir kısmı; fazlası `CLAIM_ITEMS_INVALID`). Onay, bildirimi önce atomik olarak kapatır (iki ekran aynı bildirimi iki kez ödeyemez), sonra seçilen ürünler için kısmi iadeyi çalıştırır (kaynak `CLAIM`, `OrderRefund.claimId`). İade hiç gitmezse (sağlayıcı reddi vb.) bildirim yeniden açık olur ve hata ekranda görünür. Müşteriye kısmi iade mesajı gider; komisyonun iade payı her kısmi iadedeki gibi restorana döner (`docs/MUTABAKAT.md`, "Kısmi iade").
- **Ret**: `POST .../claims/:claimId/decline` gövde `{ reason }` (zorunlu, müşteriye gösterilir). Müşteriye `order.claimDeclined` mesajı gider (neden ile).
- **Yükseltme** (`claim_escalation` modül anahtarı, varsayılan kapalı): restoranın `CLAIM_DECISION_HOURS` (24) saat içinde karara bağlamadığı bildirim `ESCALATED` durumuna geçer (`ClaimsWatchdog`, 10 dakikada bir; `escalatedAt`, denetim kaydı `claim.escalate`). Restoran hâlâ karar verebilir; panel kartta "platform ekibine de iletildi" notu gösterir. Platform konsolu `/admin/bildirimler` sırayı listeler (`GET /admin/claims`) ve restoran adına onaylar (`POST /admin/claims/:id/approve`, gövde boş veya `{ items }`) ya da reddeder (`POST /admin/claims/:id/decline`, `{ reason }`); kurallar restoranın kendi kararıyla aynıdır: onay restorana yansıyan kısmi iadedir, komisyonun iade payı geri döner. Konsol yalnızca yükseltilmiş bildirime karar verir; her karar `claim.platform.approve` / `claim.platform.decline` denetim kaydı bırakır. Müşteri takip sayfasında "bildiriminiz platform ekibine iletildi" görür.
- **Tekrar eden bildirim uyarısı** (aynı anahtar): bekleyen bildirimi olan siparişin ayrıntısında, müşterinin bu restorandaki son `REPEAT_CLAIM_WINDOW_DAYS` (90) gündeki diğer bildirimleri sayılır (`customerClaimHistory`); `REPEAT_CLAIM_THRESHOLD` (3) ve üstünde personel uyarıyı görür. Konsol aynı müşterinin tüm restoranlardaki bildirimlerini görür (`platformHistory`); restoran başka restoranların verisini görmez.
- Müşteri takip sayfasında son bildirimin durumunu görür (bekliyor, onaylandı ve iade edilen tutar, reddedildi ve nedeni); karar verilmiş bir bildirimden sonra süre içindeyse kalan ürünler için yeni bildirim yapabilir. Sipariş ayrıntısı bildirimleri listeler (`claims`).

## 4. Komisyon faturası (`OWN_POS`)

- Her tamamlanan siparişin üzerindeki `platformCommissionMinor` ve `commissionVatMinor` değerleri (yerleştirme anı anlık görüntüsü) ay sonunda tek faturaya toplanır (`buildCommissionStatement`, UTC takvim ayı). Oran sonradan değişse geçmiş ay değişmez.
- `CommissionInvoice`: dönem, sipariş sayısı, matrah, komisyon, KDV, toplam, durum (`DRAFT -> ISSUED -> PAID`, gecikirse `OVERDUE`, iptalde `VOID`).
- Tahsilat: restoranın tahsilat kartından otomatik çekim (aynı kart kasası) veya havale. Fatura kesildikten `COMMISSION_INVOICE_DUE_DAYS` (10) gün sonra ödenmemişse pazaryeri listelemesi askıya alınır; panel ve masa QR çalışmaya devam eder. Günlük iş, uçlar ve ekranlar: `docs/FATURALAMA.md`.
- Kapıda ödeme, nakit ve yemek kartı siparişlerinde de komisyon tahakkuk eder; fatura aynıdır.
- Restoran paneli: `GET /restaurants/:id/payments/commission?year&month` (izin `invoices.view`) ayın dökümünü verir; `GET .../payments/settings` bu ay biriken komisyonu gösterir.

## 5. Güvenlik özeti

- Kart numarası platforma girmez: hosted sayfa, iframe, Masterpass veya cihaz cüzdanı.
- POS bilgileri ve kasa token'ları AES-256-GCM ile şifreli; anahtar env'den (geliştirme) veya KMS'ten (üretim); anahtar sürümü satırda.
- Webhook'lar imza doğrulamasından geçmeden işlenmez.
- Token parmak izi (`tokenHash`) yalnızca tekillik içindir; token'dan geri dönülemez.
- Ödeme ayarlarını yalnızca `payments.manage` izni olan personel değiştirir; kasa işlemleri kullanıcının kendi hesabıyla sınırlıdır.

## 6. Backlog

- A4: iyzico ve PayTR gateway adaptörleri ve iade akışı (bölüm 3b) yazıldı; kalan: kısmi iade, Param ve Sipay adaptörleri, sandbox hesabıyla canlı doğrulama (iade dahil), Masterpass ve bex kasa adaptörleri, yemek kartı kuruluşlarının gerçek adaptörleri. Ödeme adımının çekirdeği (niyet, hosted oturum, webhook, kapıda tahsilat) `docs/YEMEK_KARTI.md` ile kuruldu.
- A5 tamamlandı (`docs/FATURALAMA.md`); kalan: gerçek e-Arşiv entegratörü adaptörü.
- B4: `PLATFORM_PSP` pazaryeri ürünü, PSP token kasası, tevkifat beyanı. Defter satırları ve haftalık hakediş planlaması hazır (`docs/MUTABAKAT.md`); kalan ödeme sağlayıcısı adaptörü.
- Hukuk: `OWN_POS` modunda tevkifat yükümlülüğünün olmadığının vergi danışmanıyla teyidi; Masterpass ve bex üye işyeri sözleşmeleri.
