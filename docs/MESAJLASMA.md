# Mesajlaşma motoru ve bildirimler

Tek bir motor her mesajı gönderir (`MessagingService`, `apps/api/src/modules/messaging`). Kanal tercihi ve yedek kanal restoran ayarıdır; her deneme `message_logs` satırıdır; kredi yalnızca sağlayıcı mesajı kabul ettiğinde (`SENT`) restoranın o kanaldaki cüzdanından düşer (CLAUDE.md kural 9, `docs/FIYATLANDIRMA.md`).

## Kurallar

- **Şablon**: her mesajın metni `messaging.template.<anahtar>` mesajıdır ve alıcının dilinde (müşterinin `locale` değeri, yoksa restoranın `defaultLocale` değeri) üretilir. Anahtarlar `MESSAGE_TEMPLATE_KEYS` içindedir; koda düz metin yazılmaz.
- **Platform trafiği**: doğrulama kodu (`otp.code`) ve personel daveti (`staff.invite`) `billable: false` ile gider; cüzdan kontrol edilmez ve düşülmez. OTP kaydı `restaurantId` olmadan tutulur.
- **Ücretli mesaj**: gönderimden önce cüzdan bakiyesi kontrol edilir; kredi yoksa sağlayıcıya gidilmez ve kayıt `FAILED / INSUFFICIENT_CREDITS` olur. Sağlayıcı kabul edince düşüm atomik bir güvenceyle yapılır (`balance >= 1` koşuluyla azaltma), böylece eş zamanlı iki gönderim cüzdanı eksiye düşüremez. Her düşüm `message_transactions` içinde `DEBIT`, kalan bakiye ve log kimliğiyle kayıtlıdır.
- **Kanal ve yedek**: tercih `WHATSAPP` ise önce WhatsApp sağlayıcısı denenir; reddederse veya WhatsApp kredisi yoksa ve `fallbackToSms` açıksa aynı metin SMS olarak gider. İki deneme iki kayıttır; yalnızca kabul edilen deneme kredi düşer.
- **Sağlayıcılar**: `SMS_PROVIDER` ve `WHATSAPP_PROVIDER` jetonlarının arkasındadır (`apps/api/src/modules/messaging/providers`). `MOCK` varsayılandır: üretim dışında kabul eder, üretimde reddeder ve günlüğe yazar. Gerçek adaptörler: `NETGSM` (REST v2, Basic auth, `00/01/02` kabul, bakiye paket toplamı), `ILETI_MERKEZI` (v1 JSON, durum `200` kabul, bakiye kalan SMS), `TWILIO` (Programmable Messaging, form gövde, `queued/accepted/sending/sent` kabul; para bakiyesi kredi eşiğiyle kıyaslanamayacağı için bakiye bildirilmez) ve WhatsApp için `META` (Business Cloud API, 24 saatlik hizmet penceresinde metin mesajı; pencere dışında Meta onaylı şablon ister, bugün modellenmediğinden ret döner ve motor SMS yedeğine iner). Adaptör `env.ts` ile seçilir ve kimlik bilgileri eksikse uygulama açılışta durur; sağlayıcı reddi `PROVIDER_REJECTED`, ağ hatası ve zaman aşımı (10 sn) `PROVIDER_ERROR` olur. İstek ve yanıt biçimleri birim testlerle sabitlenmiştir (`providers.spec.ts`); canlı doğrulama sağlayıcının test hesabıyla yapılır.

## Sipariş bildirimleri

`OrderNotificationsService` bir geçiş işlendikten sonra çağrılır ve asla hata fırlatmaz; sağlayıcı kesintisi mutfağı durduramaz. Hangi geçişlerin mesaj ürettiği `orderNotificationTemplate()` içindedir:

| Geçiş | Teslimat | Gel al | Masa |
| --- | --- | --- | --- |
| `ACCEPTED` (hazırlık süresi ve takip bağlantısı ile) | evet | evet | hayır |
| `READY` | hayır | evet | hayır |
| `OUT_FOR_DELIVERY` (canlı takip bağlantısı ile) | evet | hayır | hayır |
| `REJECTED`, `CANCELLED_BY_RESTAURANT` (neden varsa eklenir; çevrim içi ödeme varsa "iade edildi" veya "iade edilecek" notu da) | evet | evet | hayır |
| `REFUNDED`, yalnızca tamamlanmış siparişin iadesinde (`order.refunded`; iptalin iadesi iptal mesajında söylenir) | evet | evet | hayır |

`DELIVERED` mesajlanmaz: takip sayfası zaten gösterir ve müşterinin elindeki habere kredi harcanmaz. Alıcı numarası siparişin müşteri kaydından, yoksa adres anlık görüntüsündeki iletişim numarasından alınır; numara yoksa mesaj yoktur. Restoran `customerOrderUpdates` ayarıyla tümünü kapatabilir.

Bu mesajlar işlemsel (hizmet) mesajlarıdır: müşterinin kendi siparişi hakkındadır, ticari ileti sayılmaz ve İYS / sessiz saat kontrolüne tabi değildir. Kampanya ve pazarlama mesajları (PRO) ticari iletidir; izin kaydı, İYS sorgusu ve sessiz saat kontrolü kampanya modülündedir (`docs/KAMPANYALAR.md`) ve gönderim `campaign.body` şablonuyla aynı motordan, `billable: true` ve yedek kanalsız geçer.

## Push bildirimleri

Mobil uygulama (`docs/MOBIL.md`) her girişten sonra cihazının Expo push jetonunu `POST /me/devices` ile kaydeder ve çıkışta `DELETE /me/devices/:token` ile siler (`push_devices`; cihaz kişiye aittir, restorana değil, aynı telefon müşteri, kurye ve personel bildirimlerini rolüne göre alır). Gönderim `PushService` üzerinden `PUSH_PROVIDER` jetonunun arkasındaki sağlayıcıyla yapılır: `EXPO` Expo push servisine gider (APNs ve FCM kimlikleri Expo projesindedir, platformda tutulmaz; isteğe bağlı `EXPO_ACCESS_TOKEN`), `MOCK` üretim dışında kabul eder, üretimde reddeder.

Kurallar:

- **Push ölçülmez.** Her deneme `message_logs` satırıdır (`channel = PUSH`, `creditsCharged = 0`); cüzdan kontrol edilmez ve düşülmez (CLAUDE.md kural 9).
- **Push ücretli mesajın yerine geçer.** `OrderNotificationsService` önce müşterinin aktif cihazlarına push dener (`customerPushTemplate()`); en az bir cihaz kabul edildiyse SMS / WhatsApp gönderilmez ve restoranın kredisi harcanmaz. Hiç cihaz yoksa veya sağlayıcı reddettiyse akış eskisi gibi ücretli kanala iner.
- **Ölü cihaz kapanır.** Sağlayıcı jetonun artık kayıtlı olmadığını söylerse (`DeviceNotRegistered`) kayıt `FAILED / DEVICE_GONE` olur, cihaz `disabledAt` ile kapatılır ve aynı güncelleme ücretli kanaldan gider; uygulama bir sonraki açılışta yeniden kaydolunca cihaz tekrar açılır.
- **Yalnızca push ile giden güncellemeler**: kurye yaklaşıyor (`ARRIVING`) ve sipariş tamamlandı (`DELIVERED` / `PICKED_UP`, değerlendirme daveti). Bunların ücretli şablonu yoktur; cihaz yoksa hiçbir şey gönderilmez. Masa siparişleri (`DINE_IN`) hiç push almaz.
- **Kurye**: sefer atandığında (`assignCourier`) kuryenin telefonuna `trip.assigned` gider; dokunma sefer ekranını açar.
- **Personel**: müşterinin kendi verdiği sipariş (masa QR, restoran sayfası, pazaryeri) `orders.view` iznine sahip aktif personelin telefonlarına `order.placed` olarak düşer; telefonla alınıp personelin kendisinin girdiği sipariş (`PHONE`) uyarı üretmez.
- Metinler `messaging.push.<anahtar>.title` ve `.body` mesajlarıdır; dil cihazın bildirdiği dil, yoksa profil dili, yoksa restoranın varsayılan dilidir. Bildirim verisi (`kind: tracking | trip | orders`) uygulamanın hangi ekranı açacağını söyler; uygulama tanımadığı veriyle gezinmez (`pushRouteFor()`).

## Krediler ve satın alma

- Cüzdanlar kanal başınadır (`SMS`, `WHATSAPP`); yeni restoran hoş geldin bakiyesiyle başlar (`WELCOME_MESSAGE_CREDITS_DEFAULT`).
- Paketler platform verisidir (`message_credit_packages`, para birimiyle); restorana yalnızca kendi para birimindeki paketler listelenir.
- Satın alma `POST /restaurants/:id/messaging/purchase` (`subscription.manage`): alıcının kayıtlı kartı (`/me/payment-methods`, kart kasası jetonu) kasa üzerinden çekilir; kart numarası platforma girmez. `CAPTURED` olunca krediler `PURCHASE` hareketiyle cüzdana eklenir. `REQUIRES_3DS` yanıtı banka doğrulamasına yönlendirir; gerçek kasa adaptörü bağlanınca krediler kasanın geri dönüş bildirimiyle eklenecektir (bugün MOCK kasa anında çeker).
- Süper adminin elle kredi yüklemesi A8 ile gelir (`grant()` hazırdır).

## Uçlar ve ekran

- `GET /restaurants/:id/messaging` (`messaging.manage`): cüzdanlar, paketler, son 50 mesaj, bildirim ayarları.
- `PATCH /restaurants/:id/messaging/settings` (`messaging.manage`): `customerOrderUpdates`, `channel`, `fallbackToSms`.
- `POST /restaurants/:id/messaging/purchase` (`subscription.manage`).
- Panel: `/panel/<slug>/plan` (`subscription.manage`; ayarlar ve mesaj geçmişi `messaging.manage` olana görünür).

## Sağlayıcı bakiyesi

SMS ve WhatsApp adaptörleri isteğe bağlı `balance()` ile kalan krediyi bildirir (`MOCK` sabit bir değer döner; gerçek adaptör sağlayıcının hesap ucunu sorar). `ProviderBalanceMonitor` saatte bir okur ve `PROVIDER_BALANCE_WARN` (500) altındaki kanal için hata günlüğü ile günde bir `provider.balance_low` denetim satırı yazar; konsolun Sistem sayfası bakiyeyi ve "Bakiye düşük" rozetini gösterir (`docs/PLATFORM_YONETIMI.md`). Bakiye bilinmiyorsa sayfa bunu söyler, uydurmaz.
