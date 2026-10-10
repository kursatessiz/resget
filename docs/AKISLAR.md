# Otomatik akışlar

Akış, bir olay olduğunda tek bir müşteriye kendiliğinden giden tek bir mesajdır: sipariş sonrası teşekkür, ilk sipariş karşılaması, değerlendirme isteği ve geri kazanım. Modül `journeys` anahtarının arkasındadır (varsayılan kapalı, BETA) ve PRO planın kampanya aracının parçasıdır (`@RequirePlanFeature('campaigns')`).

Akış mesajları kampanyalarla aynı yoldan gider (`CommercialSenderService`, `docs/KAMPANYALAR.md`):
- etkin kanal (WhatsApp kapalıysa SMS),
- kanal başına güncel izin ve gönderim sınırları (`docs/RIZA.md`),
- ülke sicili (TR'de İYS; WhatsApp İYS'ye gitmez),
- kanalda adres,
- mesajlaşma motoru (kredi yalnızca gönderilince düşer) veya e-posta kanalı (kredi yok, tek tık çıkış).

Gönderim yalnızca işletmenin saat diliminde 09:00 ile 21:00 arasında yapılır.

## Gönderim onayı ve sınırı

İşletmede `marketing_approvals` modülü açıkken akışlar kampanyalarla aynı dört göz kuralına ve 24 saatlik alıcı sınırına tabidir (`docs/ONAYLAR.md` "Otomatik akışlarda onay"):

- Akışı açmak veya açık bir akışın içeriğini (kanal, konu, metin, gecikme, siparişsiz gün, tekrar aralığı, segment) değiştirmek onayı `PENDING` yapar. İçeriği son değiştiren kişi dışında `campaigns.approve` sahibi biri onaylar veya gerekçeyle reddeder.
- Onaylanana kadar çalıştırıcı o akıştan mesaj göndermez ve geri kazanım taraması yapmaz; `lastError`: `JOURNEY_APPROVAL_REQUIRED`.
- Gönderilen her akış mesajı işletmenin son 24 saatlik alıcı sınırına sayılır; sınıra ulaşılınca akış bekler (`lastError`: `SEND_LIMIT_EXCEEDED`) ve pencere ilerledikçe devam eder. Kampanya başına sınır akışlara uygulanmaz.
- Açma, duraklatma, düzenleme, onay kararları ve çalıştırıcının durdurması `journey.*` denetim kayıtlarına yazılır (modülden bağımsız).

## Tetikleyiciler

| Tetikleyici | Ne zaman | Varsayılan gecikme | Bağlantı |
| --- | --- | --- | --- |
| `ORDER_COMPLETED` | Teslim edilen veya gel al ile alınan her sipariş | 2 saat | Var |
| `FIRST_ORDER` | Müşterinin bu işletmedeki ilk tamamlanan siparişi | 24 saat | Var |
| `REVIEW_REQUEST` | Tamamlanan sipariş; mesaj siparişi değerlendirme bağlantısını taşır | 3 saat | Var |
| `WIN_BACK` | Son siparişi N ile 2N gün önce olan müşteri (N varsayılan 45, 7 ile 365 arası) | Hemen | Yok |

Sipariş tetikleyicileri müşteriyi, siparişi tamamlayan işlemin içinde akışa alır (`JourneysService.recordCompletion`, `applyTransition`). Bu yüzden her akış ve sipariş için en fazla bir kayıt oluşur (`journey_runs` üzerinde `journeyId + orderId` tekil). Geri kazanım, çalıştırıcı tarafından en fazla saatte bir taranır. 2N sınırı, yeni açılan bir akışın yıllar önce kaybedilen müşterilere mesaj atmasını önler.

Doğum günü ve deneme bitişi (platform kiracısı) tetikleyicileri bu sürümde yok. Doğum günü, müşteriden doğum tarihi toplamayı gerektirir; bu ayrıca karar verilecek bir kişisel veri işlemesidir.

## Metin

Metin kanal kurallarına uyar: SMS ve WhatsApp en çok 300 karakter ve konusuz, e-posta konulu (`journeyContentIssue()`). Kullanılabilir alanlar:
- `{name}`: müşterinin ilk adı.
- `{restaurant}`: işletmenin adı.
- `{link}`: siparişin takip ve değerlendirme sayfası. Yalnızca sipariş tetikleyicilerinde kullanılabilir; geri kazanımda kullanılırsa şema reddeder.

Ekran her tetikleyici için önerilen bir metin sunar.

## Kimler girer, kimler girmez

- **Segment**: bir segment seçilmişse (`segments_v2`) müşteri giriş anında segmente uymalıdır. Segment silinmişse akış kimseyi almaz; bir akışın kullandığı segment silinemez (`SEGMENT_IN_USE`).
- **Tekrar aralığı** (`cooldownDays`, varsayılan 30): aynı akıştan aynı müşteriye bu süre içinde ikinci kayıt açılmaz. Geri kazanımda süre en az N gündür.
- **İzin**: izni olmayan müşteri de akışa girer, ama mesaj zamanı geldiğinde gerekçesiyle atlanır (`SKIPPED`, ör. `NO_CONSENT`). Raporda böylece kaç kişinin izin vermediği görünür.

## Çıkış koşulları

Zamanı gelen kayıt, gönderilmeden önce yeniden denetlenir ve gerekçesi kalmamışsa iptal edilir (`CANCELLED`):

- `ORDER_CANCELLED`: sipariş ödenmedi, iptal edildi, reddedildi veya iade edildi.
- `ALREADY_RATED`, `RATING_CLOSED`, `RATINGS_OFF`: değerlendirme isteğinde sipariş değerlendirilmiş, süre dolmuş veya değerlendirme modülü kapalı.
- `ORDERED_AGAIN`: geri kazanımda müşteri bu arada sipariş vermiş.
- `EXPIRED`: zamanından bir haftadan fazla geçmiş kayıt (ör. akış uzun süre duraklatıldıysa) bağlamından kopmuş sayılır ve gönderilmez.

Duraklatılan akışın bekleyen kayıtları bekler. Modül kapalıyken, e-posta alan adı doğrulanmamışken, kredi yetmezken, onay beklerken veya 24 saatlik sınıra ulaşılmışken akış durur, kayıtlar beklemede kalır ve gerekçe akışın `lastError` alanında görünür. Koşul düzelince kaldığı yerden devam eder.

## Dönüşüm

Akış mesajları kampanya mesajlarıyla yarışır: müşterinin siparişi, her biri kendi dönüşüm penceresinde olan mesajlardan en son gönderilene yazılır (`CampaignAttributionService`). Kurallar `docs/KAMPANYALAR.md` "Kampanyalar v2" ile aynıdır: ilk sipariş, ürün brüt tutarı, iptaller hariç. Akış listesinde her akış için bekleyen, gönderilen, atlanan, iptal edilen ve başarısız mesaj sayıları ile dönüşüm ve atfedilen ciro görünür.

## API

`/restaurants/:restaurantId/journeys`, `@RequireFeature('journeys')` ve `@RequirePlanFeature('campaigns')`:

- `GET` (`campaigns.view`): `{ currency, approvalRequired, items }`, sayaçlar ve onay durumuyla (`approval`).
- `POST` (`campaigns.manage`): yeni akış her zaman duraklatılmış başlar.
- `PATCH :id` (`campaigns.manage`): alanlar ve `status` (`ACTIVE` / `PAUSED`). E-posta akışı yalnızca gönderebilecekse açılır (`EMAIL_DOMAIN_NOT_VERIFIED`). Modül açıkken açmak veya açık akışın içeriğini değiştirmek onay ister.
- `DELETE :id` (`campaigns.manage`): akış ve kayıtları silinir.
- `POST :id/approval/approve`, `POST :id/approval/reject { note }` (`campaigns.approve`, `marketing_approvals` açık): içeriği son değiştiren kişi karar veremez (`APPROVAL_SELF_FORBIDDEN`).

Çalıştırıcı (`JourneysRunner`) dakikada bir döner; testte ve `CAMPAIGN_RUNNER=off` ile kapalıdır. Her geçişte bekleyen kaydı olan her akış kendi partisini alır; kredisi biten, gönderim penceresi dışında kalan veya e-posta alan adı eksik akışlar başka akışların sırasını tutmaz. Kapalı modüldeki geri kazanım akışları da tarandı olarak işaretlenir, tarama sırasını tıkamaz.

## Ekranlar

`/panel/<slug>/akislar` (`campaigns.view`, modül açık; Temel planda plan kuralı) ve `/pazarlama/akislar`:
- yeni akış formu (ad, tetikleyici ve açıklaması, kanal, e-postada konu, metin ve alan yardımı, önerilen metin, gecikme, geri kazanımda siparişsiz gün, tekrar aralığı, dönüşüm penceresi, segment),
- akış listesi (durum, özet, sayaçlar, dönüşüm, durma gerekçesi; aç, duraklat, düzenle, sil),
- onay modülü açıkken onay durumu, isteyen ve karar veren, ret gerekçesi ve onaylayanlar için "Onayla" ile gerekçeli "Reddet".

## Veri

- `journeys`: kiracı, tetikleyici, kanal, metin, gecikme, siparişsiz gün, tekrar aralığı, dönüşüm penceresi, segment, durum, son hata, son tarama, onay alanları, içeriği son değiştiren kişi ve zaman.
- `journey_runs`: akış, müşteri, sipariş, zaman, durum, hata, mesaj kaydı, gönderim, dönüşen sipariş ve ciro.

Migration'lar: `20261106000000_journeys`, `20261214000000_journey_approvals`.

## Testler

- `packages/shared/src/journeys.spec.ts`: alanların doldurulması, ilk ad, metin kuralları, şema.
- `apps/api/test/e2e/journeys.e2e-spec.ts`:
  - modül anahtarı, duraklatılmış başlangıç, metin denetimi;
  - tamamlanan siparişte kayıt ve zamanında gönderim (alanlar dolu, değerlendirme bağlantısı);
  - ikinci siparişte ilk sipariş akışının ve tekrar aralığının işlemesi;
  - iade ve değerlendirme ile iptal, izinsiz müşterinin atlanması;
  - geri kazanım penceresi ve yeniden sipariş ile iptal;
  - akış mesajına dönüşüm yazılması;
  - segment silme koruması.
- `apps/api/test/e2e/journey-approvals.e2e-spec.ts`: onay modülü altında akış onayı, 24 saatlik sınır ve denetim kayıtları (`docs/ONAYLAR.md`).
- `apps/web/e2e/journeys.e2e.ts`: kapalıyken 404, önerilen metinle değerlendirme akışı, açma ve duraklatma.
