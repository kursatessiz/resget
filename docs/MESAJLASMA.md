# Mesajlaşma motoru ve bildirimler

Tek bir motor her mesajı gönderir (`MessagingService`, `apps/api/src/modules/messaging`). Kanal tercihi ve yedek kanal restoran ayarıdır; her deneme `message_logs` satırıdır; kredi yalnızca sağlayıcı mesajı kabul ettiğinde (`SENT`) restoranın o kanaldaki cüzdanından düşer (CLAUDE.md kural 9, `docs/FIYATLANDIRMA.md`).

## Kurallar

- **Şablon**: her mesajın metni `messaging.template.<anahtar>` mesajıdır ve alıcının dilinde (müşterinin `locale` değeri, yoksa restoranın `defaultLocale` değeri) üretilir. Anahtarlar `MESSAGE_TEMPLATE_KEYS` içindedir; koda düz metin yazılmaz.
- **Platform trafiği**: doğrulama kodu (`otp.code`) ve personel daveti (`staff.invite`) `billable: false` ile gider; cüzdan kontrol edilmez ve düşülmez. OTP kaydı `restaurantId` olmadan tutulur.
- **Ücretli mesaj**: gönderimden önce cüzdan bakiyesi kontrol edilir; kredi yoksa sağlayıcıya gidilmez ve kayıt `FAILED / INSUFFICIENT_CREDITS` olur. Sağlayıcı kabul edince düşüm atomik bir güvenceyle yapılır (`balance >= 1` koşuluyla azaltma), böylece eş zamanlı iki gönderim cüzdanı eksiye düşüremez. Her düşüm `message_transactions` içinde `DEBIT`, kalan bakiye ve log kimliğiyle kayıtlıdır.
- **Kanal ve yedek**: tercih `WHATSAPP` ise önce WhatsApp sağlayıcısı denenir; reddederse veya WhatsApp kredisi yoksa ve `fallbackToSms` açıksa aynı metin SMS olarak gider. İki deneme iki kayıttır; yalnızca kabul edilen deneme kredi düşer.
- **Sağlayıcılar**: `SMS_PROVIDER` ve `WHATSAPP_PROVIDER` jetonlarının arkasındadır. Bugün ikisi de MOCK'tur: üretim dışında kabul eder, üretimde reddeder ve günlüğe yazar; gerçek adaptörler (Netgsm, İleti Merkezi, Twilio; WhatsApp Business API) aynı arayüzle `env.ts` içindeki anahtarlarla bağlanır.

## Sipariş bildirimleri

`OrderNotificationsService` bir geçiş işlendikten sonra çağrılır ve asla hata fırlatmaz; sağlayıcı kesintisi mutfağı durduramaz. Hangi geçişlerin mesaj ürettiği `orderNotificationTemplate()` içindedir:

| Geçiş | Teslimat | Gel al | Masa |
| --- | --- | --- | --- |
| `ACCEPTED` (hazırlık süresi ve takip bağlantısı ile) | evet | evet | hayır |
| `READY` | hayır | evet | hayır |
| `OUT_FOR_DELIVERY` (canlı takip bağlantısı ile) | evet | hayır | hayır |
| `REJECTED`, `CANCELLED_BY_RESTAURANT` (neden varsa eklenir) | evet | evet | hayır |

`DELIVERED` mesajlanmaz: takip sayfası zaten gösterir ve müşterinin elindeki habere kredi harcanmaz. Alıcı numarası siparişin müşteri kaydından, yoksa adres anlık görüntüsündeki iletişim numarasından alınır; numara yoksa mesaj yoktur. Restoran `customerOrderUpdates` ayarıyla tümünü kapatabilir.

Bu mesajlar işlemsel (hizmet) mesajlarıdır: müşterinin kendi siparişi hakkındadır, ticari ileti sayılmaz ve İYS / sessiz saat kontrolüne tabi değildir. Kampanya ve pazarlama mesajları (PRO) ticari iletidir; onlar için izin kaydı, İYS sorgusu ve sessiz saat kontrolü kampanya modülüyle gelir ve aynı motordan geçer.

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
