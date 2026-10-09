# Platform cüzdanları: Masterpass ve bex

Karar (sahip): cüzdanlar platform düzeyinde bağlanır (Masterpass, BKM Express / bex). Apple Pay Türkiye'de geçerli değildir. Kasa kavramının bütünü `docs/ODEME.md` bölüm 3'tedir; bu belge müşterinin cüzdan kartıyla sipariş ödemesini anlatır.

Modül anahtarı `platform_wallets` (ödeme, varsayılan kapalı, BETA):

- Genel anahtar müşterinin hesabında cüzdan bağlamasını açar.
- Restoran düzeyindeki değer, restoranın cüzdanla ödeme kabul edip etmediğini belirler.

## Neden yalnızca `PLATFORM_PSP`

Platform düzeyindeki cüzdanla yapılan çekim platformun üye işyerine gider. Bu yüzden cüzdanla ödeme yalnızca parayı zaten platformun tahsil ettiği restoranlarda (`PLATFORM_PSP`) sunulur.

`OWN_POS` restoranında tahsilat restoranın kendi POS'una gelir. Platformun üye işyerinden geçen bir çekim bu para akışını bozar (`docs/MUTABAKAT.md`). Restoranın kendi POS'unun cüzdan entegrasyonu ayrı bir iştir ve sahip kararı gerektirir.

## Cüzdanlar ve adaptörler

| Kod | Ad | Durum |
|---|---|---|
| `MASTERPASS` | Masterpass | Adaptör üye işyeri sözleşmesinden sonra yazılır |
| `BEX` | bex | Adaptör üye işyeri sözleşmesinden sonra yazılır |

- **Ortak arayüz**: her cüzdan `CardVaultAdapter` arkasındadır (`beginLink`, `completeLink`, `charge`, `forget`). `PaymentsRegistry.wallets` kod başına bir adaptör tutar. Restoran faturası ve kredi alımında kullanılan kasa (`registry.vault`) ayrıdır; kayıtlı kart hangi kasadan geldiyse çekim o kasanın adaptörüyle yapılır (`vaultFor(provider)`).
- **Gerçek adaptörler**: sözleşme ve sağlayıcı belgeleri olmadan yazılmaz. Üretimde bugün kayıtlı cüzdan adaptörü yoktur, bu yüzden modül açılsa da hiçbir cüzdan sunulmaz.
- **Geliştirme ve test**: üretim dışında her iki kod için de sahte (mock) bir kasa kaydedilir. Bağlama tek bir test kartı döner, çekim hemen tahsil edilir. Böylece akışın tamamı uçtan uca denenir.

## Müşteri: cüzdan bağlama

Hesabım sayfasında (`/hesabim`) "Cüzdanlarım" kartı yer alır. Kart, modül genel olarak açıkken ve en az bir cüzdan adaptörü varken görünür.

- **Bağlama**: müşteri cüzdanı seçer (`POST /me/wallets/:code/link`, `{ returnUrl }`). Cüzdan kendi arayüzünde bağlamayı yapar (Masterpass'te telefon numarası ve OTP) ve müşteriyi geri döndürür. Dönüşte `POST /me/wallets/:code/link/complete` (`{ payload }`) kartları kaydeder.
- **Kayıt**: platform yalnızca cüzdanın token'ını şifreli tutar (`SavedPaymentMethod`, `provider` cüzdanın kodu). Kart numarası platforma girmez.
- **Liste**: `GET /me/wallets`, açık cüzdanları ve müşterinin cüzdan kartlarını döner.
- **Silme**: mevcut `DELETE /me/payment-methods/:id` ucuyla yapılır. Kartın kendi cüzdanının `forget` çağrısı da yapılır.

## Müşteri: cüzdanla ödeme

Sipariş sayfasında oturum açmış müşteri, restoran cüzdan kabul ediyorsa ödeme seçeneklerinde cüzdan kartlarını görür (örneğin "Masterpass, Mastercard •••• 4242").

- **Restoranın kabul koşulları**: `AcceptedPaymentMethodsDTO.wallets`. Hepsi sağlanmalıdır:
  - restoran `PLATFORM_PSP`'dir;
  - çevrim içi ödeme açıktır;
  - modül restoran için açıktır;
  - cüzdanın adaptörü vardır.
- **Seçim**: ödeme niyeti `ONLINE_CARD` olur ve `savedPaymentMethodId` taşır.
- **Doğrulama**: sipariş yazılmadan önce kartın oturumdaki müşteriye ait olduğu ve restoranın o cüzdanı kabul ettiği doğrulanır. Aksi halde `WALLET_UNAVAILABLE` döner. Oturum yoksa `WALLET_SIGN_IN_REQUIRED` döner.
- **Çekim**: sipariş `PENDING_PAYMENT` olarak yazılır, ardından cüzdanın adaptörüyle platformun üye işyerinde çekim yapılır (`merchantRef: 'platform'`, sipariş referansı siparişin kimliği). Sonuç:
  - **Tahsil edildi**: ödeme `CAPTURED` olur, sipariş hemen `PLACED` olur.
  - **3-D Secure gerekiyor**: müşteri sağlayıcının doğrulama sayfasına yönlendirilir. Sonuç platformun webhook adresine gelir (`/webhooks/payments/platform/<kod>`, `docs/ODEME.md`) ve diğer platform tahsilatları gibi işlenir.
  - **Reddedildi**: müşteri aynı sipariş için hosted ödeme sayfasına yönlendirilir. Kartını orada girebilir.
- **Ödeme kaydı**: `provider` platformun ödeme sağlayıcısının kodudur, çünkü cüzdan çekimi platformun üye işyeri üzerinden geçer. İade de oradan yapılır (`docs/ODEME.md`, "İade"). Hangi cüzdan kartının kullanıldığı `savedPaymentMethodId` alanında durur.
- **Siparişe etkisi**: hesap motoru, komisyon ve hakediş, diğer `PLATFORM_PSP` kart ödemeleriyle aynıdır.

## Mobil uygulama

Faz 0'da sipariş web sayfasında verilir (`docs/MOBIL.md`); uygulama cüzdanı kendi içinde bağlar ve sipariş sayfasını müşterinin oturumuyla açar. Böylece bağlanan kart ödeme seçeneklerinde hazır bulunur.

- **Cüzdanlarım kartı**: uygulamanın "Siparişlerim" ekranında görünür. Görünme koşulu webdeki kartla aynıdır: `GET /me/wallets` en az bir cüzdan döndürmelidir. Kart, bağlı cüzdan kartlarını listeler ve her cüzdan için bir bağlama düğmesi gösterir. Kart kaldırma onay ister ve mevcut `DELETE /me/payment-methods/:id` ucunu çağırır.
- **Bağlama**: uygulama `POST /me/wallets/:code/link` ucunu dönüş adresiyle çağırır. Dönüş adresi `<web adresi>/uygulama/cuzdan/<kod>` biçimindedir. Cüzdanın sayfası cihazın tarayıcısında açılır.
- **Dönüş**: dönüş adresi evrensel bağlantıdır (iOS `associatedDomains`, Android doğrulanmış `intentFilters`). Bu yüzden cüzdan müşteriyi doğrudan uygulamaya geri getirir. Uygulama adresteki parametreleri `payload` olarak `POST /me/wallets/:code/link/complete` ucuna gönderir ve kartı listeler.
- **Tarayıcıda kalırsa**: işletim sistemi bağlantıyı uygulamaya vermezse web aynı adreste bir geçiş sayfası gösterir. Sayfadaki "Uygulamaya dön" düğmesi aynı parametrelerle uygulamanın kendi şemasını açar (`resget://uygulama/cuzdan/<kod>`). Web bu sayfada bağlamayı kendisi tamamlamaz, çünkü kart uygulamadaki hesaba bağlanır.
- **Ödeme**: uygulamadaki "Tekrar sipariş ver" ve işletme bağlantıları sipariş sayfasını tek kullanımlık oturum aktarımıyla açar (`docs/GUVENLIK.md`, "Uygulamadan web'e oturum aktarımı"). Müşteri web'de yeniden giriş yapmaz. Restoran cüzdan kabul ediyorsa cüzdan kartları ödeme seçeneklerinde görünür. Çekim, doğrulama ve hata kodları yukarıdaki "Müşteri: cüzdanla ödeme" bölümüyle aynıdır.
- **Uygulama içi yerel ödeme ekranı**: müşteri modunun yerel sipariş ekranıyla (Faz 1) gelir. Gerçek Masterpass ve bex adaptörleri gelince mobil SDK'larının kullanılıp kullanılmayacağı adaptörle birlikte kararlaştırılır. Bugünkü akış tarayıcı üzerinden çalışır ve SDK gerektirmez.

## Uçlar

| Uç | Yetki |
|---|---|
| `GET /me/wallets` | Oturum |
| `POST /me/wallets/:code/link` | Oturum |
| `POST /me/wallets/:code/link/complete` | Oturum |
| `DELETE /me/payment-methods/:id` | Oturum (mevcut) |
| Sipariş verme (herkese açık sipariş uçları) | Cüzdan kartı için oturum |

Hata kodları:

- `WALLET_UNAVAILABLE`: cüzdan kapalı, restoran kabul etmiyor veya kart bu müşterinin değil.
- `WALLET_SIGN_IN_REQUIRED`: cüzdan kartıyla ödeme için oturum gerekir.

## Kalan

- Masterpass ve bex adaptörleri: üye işyeri sözleşmeleri ve sağlayıcı belgeleriyle yazılır.
- `OWN_POS` restoranlarının kendi POS'u üzerinden cüzdan: sahip kararı gerekir.
- Uygulama içinde yerel sipariş ve ödeme ekranı (müşteri modu, Faz 1).
