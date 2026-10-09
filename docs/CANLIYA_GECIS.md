# Canlıya geçiş: sözleşmesi bekleyen entegrasyonlar

Bazı entegrasyonlar bir sözleşme veya hesap olmadan kodlanamaz ya da çalıştırılamaz. Bunların her biri bir adaptör arayüzünün arkasındadır; geliştirme ve testlerde sahte (MOCK) adaptörle uçtan uca çalışır. Bu belge, her birinin üretimde sözleşme gelene kadar nasıl davrandığını ve canlıya geçerken ne yapılacağını tek yerde toplar.

Kural: **üretimde sahte adaptör hiçbir zaman "başarılı" demez.** Sözleşmesi olmayan entegrasyon platformun açılmasını engellemez, kullanıldığı anda açıkça reddeder veya bekletir. Gerçek adaptör kaydedilip ortam değişkeni ayarlandığında başka kod değişikliği gerekmez. Konsolda `/admin/sistem` ekranı her sağlayıcının o an gerçekte ne olduğunu gösterir; üretimde bağlı olmayanlar `NONE` (uyarı rengiyle) görünür.

## Kart kasası (Masterpass, bex)

- **Bugün üretimde**: kart bağlama ve kayıtlı kartla çekim `VAULT_UNAVAILABLE` ile reddedilir (`UnavailableVaultAdapter`). Restoran tahsilat kartı tanımlayamaz; komisyon faturaları havaleyle kapanır (konsolda "ödendi" işareti). Mesaj kredisi kartla satın alınamaz; havale sonrası konsoldan elle yüklenir. Platform cüzdanları ödeme seçeneği olarak görünmez.
- **Geçiş**: kasa adaptörü `CardVaultAdapter` arayüzüyle yazılır ve `apps/api/src/modules/payments/payments.registry.ts` içinde `CARD_VAULT_PROVIDER` değeri için kaydedilir; cüzdanlar `wallets` haritasına eklenir (`docs/ODEME.md` 3, `docs/CUZDAN.md`). `.env`: `CARD_VAULT_PROVIDER`, `MASTERPASS_CLIENT_ID`, `MASTERPASS_CLIENT_SECRET` (veya `BEX_*`).

## Mali belge entegratörü (e-Arşiv)

- **Bugün üretimde**: komisyon faturası kesilir, panelde ve konsolda görünür, tahsil edilir; mali numara uydurulmaz, `fiscalRef` boş kalır (`UnavailableInvoiceProvider`).
- **Geçiş**: entegratör adaptörü `InvoiceProviderAdapter` ile yazılır, `apps/api/src/modules/billing/billing.module.ts` içinde `INVOICE_PROVIDER` değeri için seçilir ve `env.ts` listesine eklenir. İlk günlük işte numarası olmayan bütün faturaların belgesi kesilir (`docs/FATURALAMA.md`).

## Ticari ileti izin sicili (İYS)

- **Bugün üretimde**: sicilin kapsadığı ülke ve kanallarda (Türkiye: SMS, arama, e-posta) hiçbir ticari ileti gönderilmez; alıcılar `CONSENT_REGISTRY` nedeniyle atlanır (`UnavailableConsentRegistry`). İzin kararları kaydedilmeye devam eder ve `registrySyncedAt` boş bekler. Sipariş bildirimleri ve OTP ticari değildir, etkilenmez. WhatsApp bugün sicilin kapsamında değildir.
- **Geçiş**: İYS adaptörü `ConsentRegistryAdapter` ile yazılır, `apps/api/src/modules/consent/consent.module.ts` içinde `CONSENT_REGISTRY_PROVIDER` değeri için seçilir. `ConsentSyncWatchdog` ilk turda biriken kararları sicile kaydeder (`docs/RIZA.md`). Her restoranın İYS marka kodu gerekir.

## Kurye ağı

- **Bugün üretimde**: test ağı (`MOCK`) kayıtlı değildir; kurye teklifi, çağrısı ve ağ bildirimi adaptör bulunamadığı için reddedilir. Restoranın kendi kuryesiyle teslimat etkilenmez.
- **Geçiş**: ağ adaptörü `CourierProviderAdapter` ile yazılır, `apps/api/src/modules/courier/courier.registry.ts` içinde kaydedilir ve konsoldan `CourierProvider` satırı açılır (`docs/KURYE.md`). `.env`: `COURIER_PROVIDER`, `COURIER_API_KEY`, `COURIER_WEBHOOK_SECRET` (üretimde ikisi de zorunludur).

## Restoran POS'u ve POS entegrasyonu

- **Bugün üretimde**: restoranın kendi sanal POS'u için test POS'u (`MOCK`) sunulmaz; iyzico ve PayTR gerçek adaptörleri hazırdır (`docs/ODEME.md` 2). Sipariş aktarımı yapılan POS entegrasyonunda (`docs/POS_ENTEGRASYONU.md`) test POS'u kayıtlı değildir; gerçek POS adaptörleri geldikçe eklenir.
- **Geçiş**: Param, Sipay veya bir sipariş POS'u için adaptör yazılıp ilgili kayıt yerine eklenir.

## Yemek kartı kuruluşları

- **Bugün üretimde**: test kuruluşu kayıtlı değildir; kapıda yemek kartı kabulü çalışır, çevrim içi yemek kartı ödemesi yalnızca adaptörü olan kuruluş için açılır (`docs/YEMEK_KARTI.md`).

## Zaten hazır olanlar

Platform PSP'si (iyzico, PayTR), SMS (Netgsm, İleti Merkezi, Twilio), WhatsApp (Meta Cloud API), e-posta (SES), push (Expo), adres (Nominatim, Google), yol (OSRM), reklam, Meta entegrasyonu ve yapay zeka adaptörleri gerçek sağlayıcılarla çalışır. Bunların sahte adaptörleri üretimde ya açılışta reddedilir ya da her gönderimi reddeder; değerler `.env.example` içinde açıklanmıştır.

## Canlıya geçiş öncesi kontrol listesi

1. `/opt/resget/.env` içinde `CREDENTIAL_ENCRYPTION_KEY` (`openssl rand -base64 32`), `JWT_SECRET`, alan adları ve platform PSP bilgileri dolu.
2. `SMS_PROVIDER`, `WHATSAPP_PROVIDER`, `EMAIL_PROVIDER`, `PUSH_PROVIDER` gerçek sağlayıcıyı gösteriyor; WhatsApp şablonları Meta'da onaylı.
3. `/admin/sistem` ekranında `NONE` görünen her satır için yukarıdaki durum bilinçli olarak kabul edildi.
4. İYS adaptörü gelmeden Türkiye'de ticari kampanya gönderilemeyeceği restoranlara duyuruldu.
