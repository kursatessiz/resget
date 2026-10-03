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

## 3a. Yemek kartları

Yemek kartlarında üye işyeri her zaman restorandır; restoran kabul ettiği kartları seçer, çevrim içi ödeme için kuruluşun API bilgilerini bağlar (POS bağlantısıyla aynı şifreleme ve doğrulama), kapıda kabul için yalnızca işaretler. Yemek kartı, nakit ve kapıda kart ödemeleri restoranın `paymentMode`'undan bağımsız olarak `OWN_POS` gibi hesaplanır (komisyon faturalanır, PSP ve tevkifat sıfır). Ödeme adımı (hosted oturum, imzalı webhook, kapıda tahsilat) ve uçlar: `docs/YEMEK_KARTI.md`.

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

- A4: `OWN_POS` için iyzico, PayTR, Param ve Sipay gateway adaptörleri (hosted sayfa + webhook); Masterpass ve bex kasa adaptörleri; yemek kartı kuruluşlarının gerçek adaptörleri. Ödeme adımının çekirdeği (niyet, hosted oturum, webhook, kapıda tahsilat) `docs/YEMEK_KARTI.md` ile kuruldu.
- A5 tamamlandı (`docs/FATURALAMA.md`); kalan: gerçek e-Arşiv entegratörü adaptörü.
- B4: `PLATFORM_PSP` pazaryeri ürünü, PSP token kasası, tevkifat beyanı. Defter satırları ve haftalık hakediş planlaması hazır (`docs/MUTABAKAT.md`); kalan ödeme sağlayıcısı adaptörü.
- Hukuk: `OWN_POS` modunda tevkifat yükümlülüğünün olmadığının vergi danışmanıyla teyidi; Masterpass ve bex üye işyeri sözleşmeleri.
