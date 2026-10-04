# Mesajlaşma motoru ve bildirimler

Tek bir motor her mesajı gönderir (`MessagingService`, `apps/api/src/modules/messaging`). Kanal tercihi ve yedek kanal restoran ayarıdır; her deneme `message_logs` satırıdır; kredi yalnızca sağlayıcı mesajı kabul ettiğinde (`SENT`) restoranın o kanaldaki cüzdanından düşer (CLAUDE.md kural 9, `docs/FIYATLANDIRMA.md`).

## Kurallar

- **Şablon**: her mesajın metni `messaging.template.<anahtar>` mesajıdır ve alıcının dilinde (müşterinin `locale` değeri, yoksa restoranın `defaultLocale` değeri) üretilir. Anahtarlar `MESSAGE_TEMPLATE_KEYS` içindedir; koda düz metin yazılmaz.
- **Platform trafiği**: doğrulama kodu (`otp.code`) ve personel daveti (`staff.invite`) `billable: false` ile gider; cüzdan kontrol edilmez ve düşülmez. OTP kaydı `restaurantId` olmadan tutulur.
- **Ücretli mesaj**: gönderimden önce cüzdan bakiyesi kontrol edilir; kredi yoksa sağlayıcıya gidilmez ve kayıt `FAILED / INSUFFICIENT_CREDITS` olur. Sağlayıcı kabul edince düşüm atomik bir güvenceyle yapılır (`balance >= 1` koşuluyla azaltma), böylece eş zamanlı iki gönderim cüzdanı eksiye düşüremez. Her düşüm `message_transactions` içinde `DEBIT`, kalan bakiye ve log kimliğiyle kayıtlıdır.
- **Kanal ve yedek**: tercih `WHATSAPP` ise önce WhatsApp sağlayıcısı denenir; reddederse veya WhatsApp kredisi yoksa ve `fallbackToSms` açıksa aynı metin SMS olarak gider. İki deneme iki kayıttır; yalnızca kabul edilen deneme kredi düşer.
- **Sağlayıcılar**: `SMS_PROVIDER` ve `WHATSAPP_PROVIDER` jetonlarının arkasındadır (`apps/api/src/modules/messaging/providers`). `MOCK` varsayılandır: üretim dışında kabul eder, üretimde reddeder ve günlüğe yazar. Gerçek adaptörler: `NETGSM` (REST v2, Basic auth, `00/01/02` kabul, bakiye paket toplamı), `ILETI_MERKEZI` (v1 JSON, durum `200` kabul, bakiye kalan SMS), `TWILIO` (Programmable Messaging, form gövde, `queued/accepted/sending/sent` kabul; para bakiyesi kredi eşiğiyle kıyaslanamayacağı için bakiye bildirilmez) ve WhatsApp için `META` (Business Cloud API; şablonu olan her mesaj onaylı şablon mesajı olarak gider, aşağıda "WhatsApp şablonları"; şablonu olmayan mesaj metin olarak gider ve yalnızca 24 saatlik hizmet penceresinde ulaşır, ret halinde motor SMS yedeğine iner). Adaptör `env.ts` ile seçilir ve kimlik bilgileri eksikse uygulama açılışta durur; sağlayıcı reddi `PROVIDER_REJECTED`, ağ hatası ve zaman aşımı (10 sn) `PROVIDER_ERROR` olur. İstek ve yanıt biçimleri birim testlerle sabitlenmiştir (`providers.spec.ts`); canlı doğrulama sağlayıcının test hesabıyla yapılır.

## Sipariş bildirimleri

`OrderNotificationsService` bir geçiş işlendikten sonra çağrılır ve asla hata fırlatmaz; sağlayıcı kesintisi mutfağı durduramaz. Hangi geçişlerin mesaj ürettiği `orderNotificationTemplate()` içindedir:

| Geçiş | Teslimat | Gel al | Masa |
| --- | --- | --- | --- |
| `ACCEPTED` (hazırlık süresi ve takip bağlantısı ile) | evet | evet | hayır |
| `READY` | hayır | evet | hayır |
| `OUT_FOR_DELIVERY` (canlı takip bağlantısı ile) | evet | hayır | hayır |
| `REJECTED`, `CANCELLED_BY_RESTAURANT` (neden varsa eklenir; çevrim içi ödeme varsa "iade edildi" veya "iade edilecek" notu da) | evet | evet | hayır |
| `REFUNDED`, yalnızca tamamlanmış siparişin iadesinde (`order.refunded`; iptalin iadesi iptal mesajında söylenir) | evet | evet | hayır |
| Kısmi iade, sipariş tamamlanmış kalırken (`order.partiallyRefunded`, iade tutarıyla; `docs/ODEME.md`, "Kısmi iade") | evet | evet | hayır |
| Eksik ürün bildiriminin reddi (`order.claimDeclined`, neden ile; onay kısmi iade mesajıyla bildirilir) | evet | evet | hayır |

`DELIVERED` mesajlanmaz: takip sayfası zaten gösterir ve müşterinin elindeki habere kredi harcanmaz. Alıcı numarası siparişin müşteri kaydından, yoksa adres anlık görüntüsündeki iletişim numarasından alınır; numara yoksa mesaj yoktur. Restoran `customerOrderUpdates` ayarıyla tümünü kapatabilir.

E-posta ayrı bir yoldan gider (`EmailService`, `docs/EPOSTA.md`); aynı `message_logs` tablosuna `EMAIL` kanalıyla yazılır ve kredi düşmez.

Bu mesajlar işlemsel (hizmet) mesajlarıdır: müşterinin kendi siparişi hakkındadır, ticari ileti sayılmaz ve İYS / sessiz saat kontrolüne tabi değildir. Kampanya ve pazarlama mesajları (PRO) ticari iletidir; izin kaydı, İYS sorgusu ve sessiz saat kontrolü kampanya modülündedir (`docs/KAMPANYALAR.md`) ve gönderim `campaign.body` şablonuyla aynı motordan, `billable: true` ve yedek kanalsız geçer.

## WhatsApp şablonları

WhatsApp, işletmenin başlattığı mesajı 24 saatlik hizmet penceresi dışında yalnızca hesapta onaylanmış bir şablonla teslim eder. Bu nedenle sipariş, fatura, listeleme, davet ve kampanya mesajları şablon mesajı olarak gider (`packages/shared/src/whatsapp-templates.ts`, `WHATSAPP_TEMPLATES`). Her kayıt şablon adını, Meta kategorisini ve mesaj parametrelerinin `{{1}}`, `{{2}}`... sırasını taşır; metnin kendisi Meta Business Manager'da dil başına kaydedilir ve `messaging.template.<anahtar>` metnini karşılar. Dil, alıcının dilinin temel kısmıdır (`tr-TR` için `tr`). OTP kodu şablonsuz kalır (SMS ile gider).

- `details` değişkeni neden, iade notu ve serbest notun birleşimidir: Meta boş veya yan yana değişken kabul etmez. Boşsa şablonun yedek metni gider (`messaging.whatsapp.details.*`). Parametreler tek satıra indirilir ve 1024 karakterle kesilir.
- Şablon onaylanmadan veya adı eşleşmeden giden mesajı Meta reddeder; motor `PROVIDER_REJECTED` yazar ve restoran izin verdiyse SMS yedeğine iner. Kredi yalnızca kabul edilen mesajda düşer.
- Meta şablonun bir değişkenle başlamasını veya bitmesini kabul etmez; aşağıdaki metinler buna göre yazılmıştır. Kategori `UTILITY` işlemsel, `MARKETING` ticari iletidir (kampanya; izin ve İYS kontrolü kampanya modülündedir).

Hesaba kaydedilecek şablonlar (Türkçe; İngilizce metinler `en` dilinde aynı değişken sırasıyla `messaging.template.<anahtar>` karşılığından yazılır):

| Şablon | Kategori | Metin (`tr`) |
| --- | --- | --- |
| `resget_staff_invite` | UTILITY | Merhaba, {{1}} sizi ekibine {{2}} olarak davet ediyor. Katılmak için {{3}} saat içinde bağlantıyı açın: {{4}} Görüşmek üzere. |
| `resget_order_accepted` | UTILITY | Merhaba, {{1}} siparişinizi ({{2}}) kabul etti; yaklaşık {{3}} dakika içinde hazır olur. Takip bağlantısı: {{4}} Afiyet olsun. |
| `resget_order_ready_for_pickup` | UTILITY | Merhaba, {{1}} siparişiniz ({{2}}) hazır, teslim alabilirsiniz. Afiyet olsun. |
| `resget_order_out_for_delivery` | UTILITY | Merhaba, {{1}} siparişiniz yola çıktı. Kuryeyi canlı izleyin: {{2}} Afiyet olsun. |
| `resget_order_rejected` | UTILITY | Merhaba, {{1}} siparişinizi ({{2}}) maalesef kabul edemedi. {{3}} Anlayışınız için teşekkürler. |
| `resget_order_cancelled` | UTILITY | Merhaba, {{1}} siparişinizi ({{2}}) iptal etti. {{3}} Anlayışınız için teşekkürler. |
| `resget_order_refunded` | UTILITY | Merhaba, {{1}} siparişinizin ({{2}}) ödemesi iade edildi. Tutarın hesabınıza geçmesi bankanıza göre birkaç gün sürebilir. |
| `resget_order_partially_refunded` | UTILITY | Merhaba, {{1}} siparişiniz ({{2}}) için {{3}} iade edildi. Anlayışınız için teşekkürler. |
| `resget_order_claim_declined` | UTILITY | Merhaba, {{1}} siparişinizdeki ({{2}}) eksik ürün bildiriminiz kabul edilmedi. {{3}} Anlayışınız için teşekkürler. |
| `resget_order_accept_overdue` | UTILITY | Dikkat: {{1}} için {{2}} numaralı sipariş {{3}} dakikadır kabul bekliyor. Sipariş ekranını açın. |
| `resget_invoice_issued` | UTILITY | Merhaba, {{1}} için {{2}} dönemi komisyon faturası {{3}}, son ödeme {{4}}. Kayıtlı kartınızdan otomatik tahsil edilir; ayrıntılar panelde. |
| `resget_invoice_overdue` | UTILITY | Merhaba, {{1}} için {{2}} dönemi komisyon faturasının ({{3}}) vadesi geçti. Pazaryeri listelemesi ödeme alınana kadar askıda; masa QR ve sipariş sayfası çalışmaya devam eder. |
| `resget_listing_approved` | UTILITY | Merhaba, {{1}} için pazaryeri listelemesi onaylandı. {{2}} Bölgenizdeki müşteriler artık sizi görebilir. |
| `resget_listing_declined` | UTILITY | Merhaba, {{1}} için pazaryeri listeleme talebi şu an onaylanamadı. {{2}} Düzenleyip panelden yeniden talep edebilirsiniz. |
| `resget_campaign` | MARKETING | Merhaba, {{1}} size yazıyor: {{2}} Bu mesajları almak istemiyorsanız: {{3}} Teşekkürler. |

Şablon adı ve değişken sırası kodla birlikte değişir; `whatsapp-templates.spec.ts` her değişkenin mesaj metninde bulunduğunu her dilde doğrular.

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
