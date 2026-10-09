# Ticari ileti izni (rıza v2)

Ticari ileti (kampanya, duyuru) izni artık kanal başına ve geçmişiyle tutulur. Her karar `contact_consents` tablosunda bir satırdır ve yalnızca eklenir; bir kanalın en son satırı o kanalın durumudur. Bir ticari iletinin gidip gidemeyeceğine tek bir saf fonksiyon karar verir (`evaluateCommercialEligibility`, `packages/shared/src/consent.ts`); gönderim yolunda hiçbir ülke kodu yazılmaz. Pazarlama yönetim paketi yol haritasının 4. maddesidir (`docs/PAZARLAMA.md`). Kardeş platformdaki rıza tasarımı örnek alınmıştır; o depoya dokunulmaz.

`consent_v2` modül anahtarının arkasındadır (varsayılan kapalı, BETA). İzin geçmişi modül kapalıyken de tutulur; anahtar yalnızca yeni davranışları açar.

| | Modül kapalı | Modül açık |
|---|---|---|
| Sipariş sırasında izin | Tek kutu ("SMS veya WhatsApp ile"), işaretlenirse iki kanala izin | Kanal başına ayrı, işaretsiz kutular (SMS, WhatsApp) |
| Çift onay | Numarası doğrulanmamış kişinin izni onay bağlantısına basılana kadar sayılmaz | Aynısı; ayrıca süper admin bir bölge seçtiyse o bölgede doğrulanmış numaranın izni de onay bekler |
| Gönderim sınırı | Yok | Müşteri başına günlük ve haftalık kampanya mesajı sınırı |
| Tacir muafiyeti | Uygulanmaz | Süper admin açtıysa uygulanır |
| Kişi kartı | İzin bölümü yok | Kanal başına durum, dayanak, kaynak, İYS durumu, geçmiş |

## Kurallar

- **İzni yalnızca kişinin kendisi verir.** Sipariş kutusu, platform sitesindeki form ve onay bağlantısı. Personel hiçbir ekrandan izin açamaz; yalnızca müşterinin kendisine ilettiği vazgeçmeyi, nasıl ilettiğine dair bir notla kaydeder.
- **Ret her şeyi yener.** Mesajdaki vazgeçme bağlantısı tüm kanallarda (SMS, WhatsApp, e-posta, arama) ret satırı yazar; o kanalda daha önce karar olmasa da yazılır, böylece sonradan hiçbir kural (tacir muafiyeti dahil) kişiye ulaşamaz. Hesabını silen kişi için de aynısı yapılır (kaynak `ACCOUNT_DELETED`).
- **Dayanak** (`legalBasis`): `CONSENT` (açık izin) veya `TR_MERCHANT_EXEMPTION` (Türkiye tacir ve esnaf muafiyeti).
- **Bölge** kişinin telefon numarasının ülke kodundan çıkarılır (`countryOfPhone`, `consentRegionOf`): `EU_UK` (AB, AEA, Birleşik Krallık, İsviçre), `TR`, `NANP` (ABD, Kanada), `OTHER`.
- **Ulaşılabilir kanallar** her yazmada yeniden hesaplanıp kişide tutulur (`restaurant_customers.consentChannels`). Kampanya kitlesi bu alanla tek sorguda seçilir, gönderim anında ise taze geçmiş yeniden değerlendirilir. Eski ekranların okuduğu `marketingOptIn` alanı "en az bir kanal ulaşılabilir" anlamına gelir.

## Gönderim sırası

Kampanya gönderiminde her alıcı için sırayla:

1. **Etkin kanal.** WhatsApp modülü kapalıyken WhatsApp kampanyası SMS olarak gider; izin, kitle ve sicil de SMS için denetlenir. Yalnızca WhatsApp izni veren müşteriye asla SMS gitmez.
2. **İzin** (`evaluateCommercialEligibility`). Ret varsa `OPTED_OUT`; onay bekleyen izin `CONSENT_UNCONFIRMED`; kapatılmış muafiyet `EXEMPTION_DISABLED`; karar yoksa `NO_CONSENT`.
3. **Gönderim sınırı** (modül açıkken). Son 24 saatte ve son 7 günde gönderilen kampanya ve otomatik akış mesajı sayısı (`docs/AKISLAR.md`) restoranın sınırına ulaştıysa `FREQUENCY_CAP`. Varsayılan günde 1, haftada 3; restoran günde en fazla 3, haftada en fazla 10'a kadar ayarlar.
4. **Bölgesel sicil.** Yalnızca sicilin kapsadığı kanallarda sorulur (`docs/KAMPANYALAR.md`). İYS bugün SMS, arama ve e-posta tutar; WhatsApp İYS'de yoktur. Onaylamazsa `CONSENT_REGISTRY`.

Atlanan alıcı `SKIPPED` ve gerekçe koduyla kampanya ayrıntısında görünür. Sessiz saat kuralı değişmedi.

## Çift onay

Sahibin kararı (9 Ekim 2026): çift onay, numarası doğrulanmamış izin için her ülkede zorunludur; numarasını doğrulamış kişi ayrıca onaylamaz.

- **Doğrulanmış numara**: izin, kişi kendi numarasıyla tek kullanımlık kodla (OTP) oturum açmışken o numara için verildiyse doğrulanmıştır. Oturum açmış müşteri siparişte kendi numarasını kullandığında kutu doğrudan sayılır; kod, numaranın sahibi olduğunu zaten kanıtlamıştır.
- **Doğrulanmamış numara**: misafir sipariş, oturum açmış kişinin başka bir numaraya verdiği sipariş, personelin telefonla girdiği sipariş ve platform sitesindeki form. Yeni izin `confirmationRequestedAt` ile bekler ve onay bağlantısına basılana kadar hiçbir kampanya veya otomatik akış mesajı gitmez (`CONSENT_UNCONFIRMED`). Bu kural modül kapalıyken de uygulanır.
- **Bölge politikası** (`marketing_settings.doubleOptInRegions`, varsayılan boş, modül açıkken): süper admin bir bölge seçerse o bölgedeki doğrulanmış numaraların izni de onay bekler. Varsayılan eskiden `EU_UK` idi; migration bu eski varsayılanı taşıyan kayıtları boşalttı.
- İşlemsel bir SMS (`consent.confirm` şablonu) onay bağlantısı gönderir. Bu SMS, doğrulama kodu gibi platform trafiğidir; restoranın kredisinden düşmez. Bağlantı `/onay/<belirteç>`: 32 rastgele bayt, veritabanında yalnızca SHA-256 özeti tutulur, 7 gün geçerlidir, tek kullanımlıktır.
- Sayfa açılınca onaylamaz; bağlantı önizlemeleri ve tarayıcılar bağlantıyı önceden açabilir. Kişi düğmeye basınca `POST /public/consent/confirm/:token` çağrılır. Yanıt nötrdür: `CONFIRMED` veya `INVALID`. Onayda kişinin bekleyen tüm izinlerine `confirmedAt` yazılır; IP ve cihaz bilgisi saklanmaz.
- Bekleyen izin İYS'ye gönderilmez; onaydan sonra gönderilir.

## Türkiye tacir ve esnaf muafiyeti

6563 sayılı Kanun'a göre tacir ve esnafa gönderilen ticari iletiler için önceden onay şartı yoktur. Kişi her zaman reddedebilir ve adresin İYS'ye tacir olarak kaydedilmesi gerekir.

- **Koşullar:** kişi "işletme" olarak işaretli (`isBusiness`), telefonu Türkiye numarası ve süper admin muafiyeti o kiracı için açmış olmalı.
- **Kanallar:** yalnızca İYS kanalları (SMS, arama, e-posta); WhatsApp muafiyete girmez.
- **Kayıt:** muafiyet çıkarımla kalmaz, yazılır. Anahtar açılınca veya bir kişi işletme olarak işaretlenince, kararı olmayan her İYS kanalı için `TR_MERCHANT_EXEMPTION` satırı yazılır ve sicile tacir olarak (`recipientType: MERCHANT`) kaydedilir. Mevcut bir karar, özellikle bir ret, asla ezilmez.
- **Anahtar kapanınca** bu satırlar sayılmaz (`EXEMPTION_DISABLED`).
- **Platform kiracısı:** kişileri restoran sahipleridir. Restoran kaydı ve site formundan gelen kişiler işletme olarak açılır; geçmiş kayıtlar migration'da işaretlendi.

## Sicil (İYS) kaydı

`ConsentRegistryAdapter.record()` kapsanan kanallardaki onaylı izinleri ve her reddi kaydeder; başarılı kayıtta satıra `registrySyncedAt` yazılır. Kayıt yazmadan hemen sonra denenir. Başarısız olanları `ConsentSyncWatchdog` 10 dakikada bir yeniden dener (testlerde kapalı). Üretim dışında adaptör `MOCK`'tur, her numarayı onaylar ve kaydı işaretler. Üretimde gerçek İYS adaptörü gelene kadar `UnavailableConsentRegistry` çalışır: kapsanan kanallarda hiçbir numara onaylanmaz (alıcı `CONSENT_REGISTRY` nedeniyle atlanır), kayıtlar `registrySyncedAt` boş bekler ve izleyici denemez; gerçek adaptör seçildiğinde (`CONSENT_REGISTRY_PROVIDER`) biriken kararları ilk turda kaydeder. Kapsanmayan kanal ve ülkeler etkilenmez, işlemsel mesajlar (sipariş bildirimi, OTP) ticari değildir ve bu kontrolden geçmez. Gerçek İYS adaptöründe her restoran kendi İYS marka koduyla gönderici olacaktır; platform kiracısı platformun markasıdır.

## Uçlar

| Uç | İzin |
|---|---|
| `GET /restaurants/:id/consent/settings`, `PUT` (günlük, haftalık sınır) | `campaigns.view` / `campaigns.manage` |
| `GET /restaurants/:id/consent/customers/:customerId` (kanal başına durum ve geçmiş) | `customers.view` |
| `POST .../customers/:customerId/opt-out` (`channels`, zorunlu `note`) | `customers.manage` |
| `PUT .../customers/:customerId/business` (`isBusiness`) | `customers.manage` |
| `GET`, `PUT /admin/restaurants/:id/consent-policy` (doğrulanmış numaralar için de çift onay istenen bölgeler, tacir muafiyeti) | süper admin |
| `POST /public/consent/confirm/:token` | herkese açık, istemci başına 10 dakikada 20 |

Restoran uçları `consent_v2` anahtarını ister (`FEATURE_DISABLED`). Sipariş uçları `marketingChannels` (`['SMS', 'WHATSAPP']` alt kümesi) alanını kabul eder; modül kapalıyken yok sayılır ve eski `marketingOptIn` geçerlidir. Platform aday formu ayrı, işaretsiz bir SMS izni kutusu taşır (`marketingConsent`, form sürümü `lead-form-1`).

## Ekranlar

- **Sipariş sayfaları** (masa QR, restoran sayfası): kanal başına izin kutuları.
- **CRM kişi kartı:** "Ticari ileti izni" bölümü. Kanal başına durum rozeti (geçerli, onay bekliyor, reddetti, karar yok) ve dayanak, kaynak, tarih ve İYS durumu gösterilir. İşletme işareti, personelin vazgeçme kaydı ve tüm geçmiş de bu bölümdedir.
- **Kampanyalar sayfası:** "Gönderim sınırları" kartı.
- **`/onay/<belirteç>`:** onay sayfası.
- **Konsol:** `/admin/pazarlama` sayfasındaki "Ticari ileti izni kuralları" kartı (platform kiracısı için çift onay bölgeleri ve tacir muafiyeti).

## Veri ve taşıma

- **Yeni tablolar:** `contact_consents`, `consent_confirmations` ve `marketing_settings` (satır yoksa `DEFAULT_CONSENT_POLICY` geçerli).
- **Yeni alanlar:** `restaurant_customers.isBusiness` ve `consentChannels`.
- **Migration** `20261102000000_consent_v2`:
  - mevcut izinler iki kanalda `LEGACY` kaynaklı izne, önceki vazgeçmeler iki kanalda `OPT_OUT_LINK` retlerine dönüştürüldü;
  - izinli müşterilerin ulaşılabilir kanalları dolduruldu;
  - platform kiracısında kayıt ve formdan gelen kişiler işletme olarak işaretlendi.
- Migration yalnızca ekler, geriye dönük uyumludur. `marketingOptIn` alanı bir sürüm daha korunur.

## Sonraki adımlar

- Mevcut müşteriye benzer ürün için "soft opt-in" dayanağı (AB/UK).
- E-posta kanalı (yol haritası 5. madde) ve e-posta ile onay.
- STOP anahtar kelimesiyle gelen ret.
- Gerçek İYS adaptörü (marka kodu, toplu yükleme, sorgu).
