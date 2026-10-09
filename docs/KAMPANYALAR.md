# Kampanyalar (Pro)

Restoran, kendi müşterilerine SMS veya WhatsApp ile tek bir mesaj gönderir. Pro planının çekirdek özelliğidir (`PLAN_FEATURE_SETS.PRO`, özellik `campaigns`); Temel plandaki restoran ekranı görür, aracı göremez. Kod: `packages/shared/src/campaigns.ts` (kurallar ve sözleşmeler), `apps/api/src/modules/campaigns` (servis, çalıştırıcı, uçlar, izin sicili adaptörü), `apps/web/src/components/panel/CampaignsManager.tsx` ve `/iptal/<token>` sayfası.

## Değişmeyen üç kural

0. **Rıza v2.** `consent_v2` açıkken izin kanal başına tutulur; kitle, çift onay, gönderim sınırı ve tacir muafiyeti `docs/RIZA.md` kurallarıyla işler. Aşağıdaki kurallar modül kapalıyken de geçerlidir; izin geçmişi her iki durumda `contact_consents` tablosundadır.
1. **Yalnızca izinli müşteri.** Alıcı kümesi `RestaurantCustomer.marketingOptIn = true` olanlardır. İzin, müşteri sipariş verirken (vitrindeki kutu, `PublicOrderSchema.marketingOptIn`) veya personel sipariş açarken (`CreateOrderSchema.marketingOptIn`) yalnızca `true` olarak kaydedilir (`marketingOptInAt`); hiçbir ekran personelin izni açmasına izin vermez. Her mesajın sonunda tek dokunuşla vazgeçme bağlantısı vardır (`/iptal/<marketingToken>`, `POST /public/marketing/opt-out/:token`); tıklayan müşteri `marketingOptOutAt` ile düşer ve bir daha ticari mesaj almaz. Sayfa ve e-postanın tek tık adresi API'yi sunucu tarafında çağırır ve ziyaretçinin adresini (`X-Forwarded-For`) iletir; böylece hız sınırı her ziyaretçiye ayrı uygulanır, yoğun bir gönderimde vazgeçmeler web sunucusunun ortak sınırına takılmaz. Herkese açık site sayfaları ve iş ortağı daveti de aynı şekilde çağrılır. Sipariş durumu mesajları (işlemsel) bundan etkilenmez (`docs/MESAJLASMA.md`).
2. **Sessiz saat yok.** Gönderim yalnızca restoranın kendi saat diliminde `CAMPAIGN_SEND_WINDOW` (09:00 ile 21:00 arası) içinde yapılır (`isWithinSendWindow`, `nextSendWindowStart`). Gece zamanlanan veya başlatılan kampanya pencerenin açılışında sürer; önizleme bunu söyler.
3. **Bölgesel izin sicili.** Sicil yalnızca kapsadığı kanallar için sorulur (`CONSENT_REGISTRY_COVERAGE`, `registryCovers()`). Türkiye'de İYS bugün SMS (MESAJ), arama (ARAMA) ve e-posta (EPOSTA) kanallarını tutar; WhatsApp henüz bir İYS kanalı değildir, bu yüzden WhatsApp kampanyasında İYS sorulmaz ve gönderimi yalnızca müşterinin kendi açık izni ve tek tık vazgeçme kaydı belirler (Meta'nın pazarlama şablonu kuralları ayrıca geçerlidir). İYS WhatsApp'ı eklediğinde değişiklik yalnızca bu listededir. Kapsanan kanalda her partiden önce `ConsentRegistryAdapter.allowed()` sorulur. Bugün `MOCK` izinli her numarayı onaylar; gerçek adaptör `CONSENT_REGISTRY_PROVIDER` ile seçilir ve onaylamadığı numaralar `SKIPPED / CONSENT_REGISTRY` olur.

Mesaj metni restoranın yazdığıdır; şablon `messaging.template.campaign.body` yalnızca restoran adını öne, vazgeçme bağlantısını sona ekler ve alıcının dilinde üretilir. Gönderim aynı mesajlaşma motorundan geçer: her alıcı bir `message_logs` satırı, sağlayıcı kabul edince o kanalın cüzdanından bir kredi (`billable: true`, yedek kanal yok).

## Yaşam döngüsü

`DRAFT -> SCHEDULED -> SENDING -> SENT`, her aşamadan `CANCELLED`. `CampaignsRunner` dakikada bir (`CAMPAIGN_RUNNER=off` kapatır, testte kapalı) `runPass()` çağırır:

- Zamanı gelmiş `SCHEDULED` kampanya `SENDING` olur ve alıcıları o anda hesaplanır (`campaign_recipients`, kampanya başına müşteri tekil). Alıcı yoksa doğrudan `SENT`.
- Pencere içindeki her `SENDING` kampanya için bir parti (`CAMPAIGN_BATCH_SIZE` = 50) `PENDING` alıcı işlenir: izni bu arada kalkan veya sicilin onaylamadığı alıcı `SKIPPED`, kabul edilen `SENT` (log kimliğiyle), sağlayıcının reddettiği `FAILED`. Kredi bitince kampanya `lastError = INSUFFICIENT_CREDITS` ile durur ve kredi gelince kaldığı yerden sürer; hiçbir alıcı iki kez mesaj almaz. Her alıcı gönderimden önce koşullu olarak ayrılır (`sentAt` ile on dakikalık kira): birden çok API örneği aynı anda çalışsa da aynı kişiye iki mesaj gitmez ve iki kez kredi düşmez; yarıda kalan bir ayrımı kira dolunca başka çalıştırıcı devralır. Her geçişte gönderimdeki bütün kampanyalar sırayla işlenir; pencere veya kredi bekleyen kampanyalar diğerlerinin yerini tutmaz.
- Başlatma tek işlemdir: durumun `SENDING` olması ile alıcıların yazılması birlikte işlenir, yalnızca bir başlatıcı kazanır; alıcısı yazılmamış bir kampanya "bitmiş" sayılamaz. Gönderime alma da yalnızca `DRAFT` veya `SCHEDULED` durumdan yapılır; arada başlamış veya iptal edilmiş kampanya yeniden kuyruğa girmez.
- Önizleme, kampanyanın gerçekte kullanacağı kanalın cüzdanını gösterir (WhatsApp modülü kapalıyken SMS).
- `PENDING` kalmayınca kampanya `SENT` ve sayaçlar (`sentCount`, `failedCount`, `skippedCount`, `audienceCount`) kapanır.

## Segment

`CampaignSegmentSchema`: en az sipariş sayısı, son N gün içinde sipariş, en az N gündür sipariş yok (hiç sipariş vermemiş müşteri de dahil), etiketlerden herhangi biri (müşteri listesindeki etiketler, `docs/PANEL.md`), ilk kanal. Boş segment izinli herkestir. Alıcı sayısı önizlemede ve başlangıçta hesaplanır; aradaki fark izin değişikliğidir.

**Segmentler v2** (`docs/SEGMENTLER.md`, anahtar `segments_v2`): modül açıkken kampanya `segmentId` ile VE / VEYA kurallı kayıtlı bir segmenti hedefleyebilir; o zaman alıcılar segmentten gelir, satır içi filtreler yok sayılır, izin denetimi aynen uygulanır. Bekleyen bir kampanyanın hedeflediği segment silinemez (`SEGMENT_IN_USE`).

**Kayıtlı segmentler** (`campaign_segments`, `SaveSegmentSchema`): restoran bir filtre kümesine ad verir ve sonraki kampanyalarda seçerek kullanır; restoran başına ad tekildir (`SEGMENT_NAME_TAKEN`). Kayıt filtreyi saklar, müşteri listesini değil: her listelemede alıcı sayısı o anki izinli müşterilerden yeniden hesaplanır. Kampanya oluşturulurken segment her zaman kampanyaya kopyalanır; kayıtlı segmentin sonradan değişmesi veya silinmesi geçmiş ve zamanlanmış kampanyayı etkilemez.

## Uçlar (`restaurants/:id/campaigns`, hepsi `@RequirePlanFeature('campaigns')`)

- `GET` (`campaigns.view`): liste; `GET audience`: toplam ve izinli müşteri sayısı.
- `POST` (`campaigns.manage`): taslak; `scheduledAt` verilirse doğrudan zamanlanır. `PATCH :id`: taslak veya zamanlanmış kampanyada ad, kanal, metin, segment.
- `POST :id/preview` (`campaigns.view`): alıcı sayısı, gereken kredi ve cüzdan bakiyesi, müşterinin göreceği örnek metin, şu an pencere içinde mi ve değilse ne zaman.
- `POST :id/send` (`campaigns.manage`): şimdi veya `scheduledAt`. `POST :id/cancel`.
- `POST :id/approval/request` (`campaigns.manage`), `POST :id/approval/approve` ve `POST :id/approval/reject` (`campaigns.approve`): `marketing_approvals` açıkken dört göz onayı; gönderim onay ve sınırlar olmadan reddedilir, önizleme `guards` alanında durumu gösterir (`docs/ONAYLAR.md`). Oluşturma, düzenleme, gönderim ve iptal her zaman denetim kaydına yazılır.
- `GET :id`: kampanya ve ilk 500 alıcının durumu.
- `POST audience/count` (`campaigns.view`): verilen filtrenin şu an kaç izinli müşteriye denk geldiği.
- `GET segments` (`campaigns.view`): kayıtlı segmentler ve güncel alıcı sayıları; `POST segments`, `PUT segments/:id`, `DELETE segments/:id` (`campaigns.manage`).
- Herkese açık: `POST /public/marketing/opt-out/:token` (oran sınırlı, idempotent).

## Kampanyalar v2 (`campaigns_v2`, varsayılan kapalı)

Modül açıkken kampanya aracına dört yetenek eklenir. Modül kapalıyken bu alanlardan herhangi biri gönderilirse istek `FEATURE_DISABLED` ile reddedilir; eski kampanyalar olduğu gibi çalışır.

- **E-posta kanalı**: `channel: 'EMAIL'` ayrıca `email_channel` modülünü ister. E-posta kampanyası konu (`subject`, en çok 120 karakter) ve en çok 5000 karakterlik metin alır, düz metinden HTML'e çevrilir ve `EmailService` üzerinden gider (`docs/EPOSTA.md`). Kitle, e-posta izni ve adresi olan müşterilerdir (kişi kartındaki adres, yoksa hesabın adresi). Her gönderimden önce bastırma listesi, EMAIL izni, doğrulanmış alan adı ve ülke sicili (TR'de İYS e-posta kaydı, adresle) denetlenir. Alt bilgide işletme adresi ve çıkış bağlantısı yer alır; `List-Unsubscribe` başlığı `/api/iptal/<token>` adresine gider: posta istemcisinin tek tıkla POST isteği (RFC 8058) sayfa açmadan çıkarır, tarayıcıda açılan adres `/iptal/<token>` sayfasına yönlenir. E-posta kredi harcamaz (önizlemede gereken kredi 0).
- **A/B testi**: `variant: { body, subject?, sharePct }`. Kitlenin `sharePct` yüzdesi (10 ile 90 arası, varsayılan 50) B metnini alır. Bölüşüm kampanya ve müşteri kimliğinden hesaplanan sabit bir özetle yapılır (`abVariantFor()`); yeniden denemede kimsenin metni değişmez. Önizleme iki metni de gösterir.
- **Kazananın otomatik seçimi** (sahibin kararı, 9 Ekim 2026): A/B testinde `variant.autoWinner: { testPct, waitHours }` verilirse kitlenin yalnızca `testPct` yüzdesi (10 ile 50 arası, varsayılan 20) teste girer ve iki metne eşit bölünür; kalan alıcılar `HOLD` olarak bekler (bölüşüm yine kampanya ve müşteri kimliğinden sabit özetle, `abAutoAssignment()`). Bu modda `sharePct` kullanılmaz. Kampanya başladıktan `waitHours` saat sonra (1 ile 72 arası, varsayılan 24) ve test alıcılarının hepsi işlendikten sonra (gönderildi, atlandı veya başarısız) gönderim turu kazananı seçer: gönderilen mesaj başına dönüşüm oranı yüksek olan metin kazanır, eşitlikte veya hiç gönderim yoksa A kazanır (`pickAbWinner()`, ondalık hesap yok). Karar bir kez yazılır (`winnerVariant`, `winnerDecidedAt`) ve denetim kaydıdır (`campaign.ab_winner`); bekleyen alıcılar kazanan metne geçer ve aynı gönderim kurallarıyla (izin, sicil, sessiz saat, kredi) gönderilir. `BEST_HOUR` kampanyada bekleyen alıcının saati geçmişse karar anından sonraki ilk turda gider. Bekleyen alıcı varken kampanya `SENT` olmaz; iptal bekleyenleri de durdurur. Sonuçlar ekranı test payını, karar zamanını, bekleyen sayısını ve kazananı gösterir.
- **Gönderim saati**: `sendTimeMode: 'BEST_HOUR'` her alıcıyı son 180 günde en sık sipariş verdiği yerel saatte gönderir (`bestHourDueAt()`); saat gönderim penceresinin (09:00 ile 21:00) içine çekilir, eşitlikte erken saat seçilir, sipariş geçmişi olmayan alıcıya hemen gönderilir. Alıcı satırındaki `dueAt` gelmeden gönderilmez; kampanya son alıcı gönderilince `SENT` olur. `FIXED` herkese seçilen anda gönderir.
- **Dönüşüm ve atfedilen ciro**: müşteri sipariş verdiğinde, son `attributionDays` gün içinde (1 ile 14 arası, varsayılan 3) aldığı en son kampanya mesajına sipariş yazılır (son mesaj kazanır). Bir mesaja yalnızca ilk siparişi yazılır, bir sipariş yalnızca bir mesaja yazılır (`campaign_recipients.convertedOrderId` tekil). Ciro, siparişin yerleştirme anındaki ürün brüt tutarıdır (para birimi restoranındır). Ödenmemiş, iptal edilen, reddedilen ve iade edilen siparişler sonuçlarda sayılmaz. Kayıt `CampaignAttributionService` ile sipariş akışında yapılır; hata siparişi asla durdurmaz.

Kampanya ve otomatik akış mesajları aynı göndericiden geçer (`CommercialSenderService`: etkin kanal, izin ve sınırlar, sicil, adres, kredi veya e-posta) ve dönüşümde yarışır: sipariş, kendi penceresindeki en son mesaja yazılır (`docs/AKISLAR.md`).

`GET :id/results` (`campaigns.view`, modül açık): metin başına alıcı, gönderilen, başarısız, atlanan, dönüşüm, atfedilen ciro (minör birim) ve dönüşüm oranı (baz puan); iki metin de gönderildiyse oranı yüksek olan `leader`. Kazananın otomatik seçimi açıksa ayrıca `autoWinner` (test payı, bekleme süresi, karar zamanı, bekleyen alıcı sayısı, kazanan); kapalıysa kazanan otomatik seçilmez, karar işletmenindir.

Metin kuralları her iki yolda da aynıdır (`campaignContentIssue()`): SMS ve WhatsApp en çok 300 karakter ve konusuz, e-posta konulu. Oluştururken şema `VALIDATION` ile, düzenlerken servis birleştirilmiş kayıt üzerinden `CAMPAIGN_CONTENT_INVALID` ile reddeder.

## Ekranlar

- `/panel/<slug>/kampanyalar` (`campaigns.view`; Pro): yeni kampanya formu (ad, kanal, metin ve karakter sayacı, segment, isteğe bağlı zaman), kayıtlı segment seçimi ve filtreleri adla kaydetme, "Alıcıyı say" ile anlık sayım, kayıtlı segment listesi ve silme, önizleme kartı, liste ve sayaçlar, alıcı listesi, iptal. Temel planda plan kuralı ve Pro'ya geçiş bağlantısı.
- Vitrin: iletişim alanının altında izin kutusu (`shop.customer.marketingOptIn`), varsayılan işaretsiz.
- `/iptal/<token>`: bağlantıyı açmak vazgeçmektir; sayfa hangi restorandan çıkıldığını söyler.
- Kampanyalar v2 açıkken form: e-posta kanalı (e-posta modülü de açıksa) ve konu alanı, "A/B testi" kutusu ile B metni, B konusu ve kitle payı, gönderim saati seçimi, dönüşüm penceresi; önizlemede B metni örneği; gönderilmekte olan veya gönderilmiş kampanyada "Sonuçlar" (metin başına gönderim, dönüşüm, oran, atfedilen ciro ve önde olan metin); alıcı listesinde metin, bekleme zamanı ve sipariş verdi işareti.

## Kalan

- Gerçek İYS adaptörü ve İYS kayıt zorunluluğu belgesi; GDPR bölgeleri için eşdeğer sicil yok, yalnızca izin ve vazgeçme uygulanır.
- Kampanya e-postalarında açılma ve tıklama ölçümü; Sadakat programı `docs/SADAKAT.md` ile geldi; segment kaydetme bu belgeyle geldi.
