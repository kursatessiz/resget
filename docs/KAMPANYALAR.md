# Kampanyalar (Pro)

Restoran, kendi müşterilerine SMS veya WhatsApp ile tek bir mesaj gönderir. Pro planının çekirdek özelliğidir (`PLAN_FEATURE_SETS.PRO`, özellik `campaigns`); Temel plandaki restoran ekranı görür, aracı göremez. Kod: `packages/shared/src/campaigns.ts` (kurallar ve sözleşmeler), `apps/api/src/modules/campaigns` (servis, çalıştırıcı, uçlar, izin sicili adaptörü), `apps/web/src/components/panel/CampaignsManager.tsx` ve `/iptal/<token>` sayfası.

## Değişmeyen üç kural

0. **Rıza v2.** `consent_v2` açıkken izin kanal başına tutulur; kitle, çift onay, gönderim sınırı ve tacir muafiyeti `docs/RIZA.md` kurallarıyla işler. Aşağıdaki kurallar modül kapalıyken de geçerlidir; izin geçmişi her iki durumda `contact_consents` tablosundadır.
1. **Yalnızca izinli müşteri.** Alıcı kümesi `RestaurantCustomer.marketingOptIn = true` olanlardır. İzin, müşteri sipariş verirken (vitrindeki kutu, `PublicOrderSchema.marketingOptIn`) veya personel sipariş açarken (`CreateOrderSchema.marketingOptIn`) yalnızca `true` olarak kaydedilir (`marketingOptInAt`); hiçbir ekran personelin izni açmasına izin vermez. Her mesajın sonunda tek dokunuşla vazgeçme bağlantısı vardır (`/iptal/<marketingToken>`, `POST /public/marketing/opt-out/:token`); tıklayan müşteri `marketingOptOutAt` ile düşer ve bir daha ticari mesaj almaz. Sipariş durumu mesajları (işlemsel) bundan etkilenmez (`docs/MESAJLASMA.md`).
2. **Sessiz saat yok.** Gönderim yalnızca restoranın kendi saat diliminde `CAMPAIGN_SEND_WINDOW` (09:00 ile 21:00 arası) içinde yapılır (`isWithinSendWindow`, `nextSendWindowStart`). Gece zamanlanan veya başlatılan kampanya pencerenin açılışında sürer; önizleme bunu söyler.
3. **Bölgesel izin sicili.** Sicil yalnızca kapsadığı kanallar için sorulur (`CONSENT_REGISTRY_COVERAGE`, `registryCovers()`). Türkiye'de İYS bugün SMS (MESAJ), arama (ARAMA) ve e-posta (EPOSTA) kanallarını tutar; WhatsApp henüz bir İYS kanalı değildir, bu yüzden WhatsApp kampanyasında İYS sorulmaz ve gönderimi yalnızca müşterinin kendi açık izni ve tek tık vazgeçme kaydı belirler (Meta'nın pazarlama şablonu kuralları ayrıca geçerlidir). İYS WhatsApp'ı eklediğinde değişiklik yalnızca bu listededir. Kapsanan kanalda her partiden önce `ConsentRegistryAdapter.allowed()` sorulur. Bugün `MOCK` izinli her numarayı onaylar; gerçek adaptör `CONSENT_REGISTRY_PROVIDER` ile seçilir ve onaylamadığı numaralar `SKIPPED / CONSENT_REGISTRY` olur.

Mesaj metni restoranın yazdığıdır; şablon `messaging.template.campaign.body` yalnızca restoran adını öne, vazgeçme bağlantısını sona ekler ve alıcının dilinde üretilir. Gönderim aynı mesajlaşma motorundan geçer: her alıcı bir `message_logs` satırı, sağlayıcı kabul edince o kanalın cüzdanından bir kredi (`billable: true`, yedek kanal yok).

## Yaşam döngüsü

`DRAFT -> SCHEDULED -> SENDING -> SENT`, her aşamadan `CANCELLED`. `CampaignsRunner` dakikada bir (`CAMPAIGN_RUNNER=off` kapatır, testte kapalı) `runPass()` çağırır:

- Zamanı gelmiş `SCHEDULED` kampanya `SENDING` olur ve alıcıları o anda hesaplanır (`campaign_recipients`, kampanya başına müşteri tekil). Alıcı yoksa doğrudan `SENT`.
- Pencere içindeki her `SENDING` kampanya için bir parti (`CAMPAIGN_BATCH_SIZE` = 50) `PENDING` alıcı işlenir: izni bu arada kalkan veya sicilin onaylamadığı alıcı `SKIPPED`, kabul edilen `SENT` (log kimliğiyle), sağlayıcının reddettiği `FAILED`. Kredi bitince kampanya `lastError = INSUFFICIENT_CREDITS` ile durur ve kredi gelince kaldığı yerden sürer; hiçbir alıcı iki kez mesaj almaz.
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
- `GET :id`: kampanya ve ilk 500 alıcının durumu.
- `POST audience/count` (`campaigns.view`): verilen filtrenin şu an kaç izinli müşteriye denk geldiği.
- `GET segments` (`campaigns.view`): kayıtlı segmentler ve güncel alıcı sayıları; `POST segments`, `PUT segments/:id`, `DELETE segments/:id` (`campaigns.manage`).
- Herkese açık: `POST /public/marketing/opt-out/:token` (oran sınırlı, idempotent).

## Ekranlar

- `/panel/<slug>/kampanyalar` (`campaigns.view`; Pro): yeni kampanya formu (ad, kanal, metin ve karakter sayacı, segment, isteğe bağlı zaman), kayıtlı segment seçimi ve filtreleri adla kaydetme, "Alıcıyı say" ile anlık sayım, kayıtlı segment listesi ve silme, önizleme kartı, liste ve sayaçlar, alıcı listesi, iptal. Temel planda plan kuralı ve Pro'ya geçiş bağlantısı.
- Vitrin: iletişim alanının altında izin kutusu (`shop.customer.marketingOptIn`), varsayılan işaretsiz.
- `/iptal/<token>`: bağlantıyı açmak vazgeçmektir; sayfa hangi restorandan çıkıldığını söyler.

## Kalan

- Gerçek İYS adaptörü ve İYS kayıt zorunluluğu belgesi; GDPR bölgeleri için eşdeğer sicil yok, yalnızca izin ve vazgeçme uygulanır.
- E-posta kanalı. Sadakat programı `docs/SADAKAT.md` ile geldi; segment kaydetme bu belgeyle geldi.
