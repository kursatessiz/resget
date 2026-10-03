# Kampanyalar (Pro)

Restoran, kendi müşterilerine SMS veya WhatsApp ile tek bir mesaj gönderir. Pro planının çekirdek özelliğidir (`PLAN_FEATURE_SETS.PRO`, özellik `campaigns`); Temel plandaki restoran ekranı görür, aracı göremez. Kod: `packages/shared/src/campaigns.ts` (kurallar ve sözleşmeler), `apps/api/src/modules/campaigns` (servis, çalıştırıcı, uçlar, izin sicili adaptörü), `apps/web/src/components/panel/CampaignsManager.tsx` ve `/iptal/<token>` sayfası.

## Değişmeyen üç kural

1. **Yalnızca izinli müşteri.** Alıcı kümesi `RestaurantCustomer.marketingOptIn = true` olanlardır. İzin, müşteri sipariş verirken (vitrindeki kutu, `PublicOrderSchema.marketingOptIn`) veya personel sipariş açarken (`CreateOrderSchema.marketingOptIn`) yalnızca `true` olarak kaydedilir (`marketingOptInAt`); hiçbir ekran personelin izni açmasına izin vermez. Her mesajın sonunda tek dokunuşla vazgeçme bağlantısı vardır (`/iptal/<marketingToken>`, `POST /public/marketing/opt-out/:token`); tıklayan müşteri `marketingOptOutAt` ile düşer ve bir daha ticari mesaj almaz. Sipariş durumu mesajları (işlemsel) bundan etkilenmez (`docs/MESAJLASMA.md`).
2. **Sessiz saat yok.** Gönderim yalnızca restoranın kendi saat diliminde `CAMPAIGN_SEND_WINDOW` (09:00 ile 21:00 arası) içinde yapılır (`isWithinSendWindow`, `nextSendWindowStart`). Gece zamanlanan veya başlatılan kampanya pencerenin açılışında sürer; önizleme bunu söyler.
3. **Bölgesel izin sicili.** Her partiden önce `ConsentRegistryAdapter.allowed()` sorulur (Türkiye: İYS). Bugün `MOCK` izinli her numarayı onaylar; gerçek adaptör `CONSENT_REGISTRY_PROVIDER` ile seçilir ve onaylamadığı numaralar `SKIPPED / CONSENT_REGISTRY` olur.

Mesaj metni restoranın yazdığıdır; şablon `messaging.template.campaign.body` yalnızca restoran adını öne, vazgeçme bağlantısını sona ekler ve alıcının dilinde üretilir. Gönderim aynı mesajlaşma motorundan geçer: her alıcı bir `message_logs` satırı, sağlayıcı kabul edince o kanalın cüzdanından bir kredi (`billable: true`, yedek kanal yok).

## Yaşam döngüsü

`DRAFT -> SCHEDULED -> SENDING -> SENT`, her aşamadan `CANCELLED`. `CampaignsRunner` dakikada bir (`CAMPAIGN_RUNNER=off` kapatır, testte kapalı) `runPass()` çağırır:

- Zamanı gelmiş `SCHEDULED` kampanya `SENDING` olur ve alıcıları o anda hesaplanır (`campaign_recipients`, kampanya başına müşteri tekil). Alıcı yoksa doğrudan `SENT`.
- Pencere içindeki her `SENDING` kampanya için bir parti (`CAMPAIGN_BATCH_SIZE` = 50) `PENDING` alıcı işlenir: izni bu arada kalkan veya sicilin onaylamadığı alıcı `SKIPPED`, kabul edilen `SENT` (log kimliğiyle), sağlayıcının reddettiği `FAILED`. Kredi bitince kampanya `lastError = INSUFFICIENT_CREDITS` ile durur ve kredi gelince kaldığı yerden sürer; hiçbir alıcı iki kez mesaj almaz.
- `PENDING` kalmayınca kampanya `SENT` ve sayaçlar (`sentCount`, `failedCount`, `skippedCount`, `audienceCount`) kapanır.

## Segment

`CampaignSegmentSchema`: en az sipariş sayısı, son N gün içinde sipariş, en az N gündür sipariş yok (hiç sipariş vermemiş müşteri de dahil), etiketlerden herhangi biri (müşteri listesindeki etiketler, `docs/PANEL.md`), ilk kanal. Boş segment izinli herkestir. Alıcı sayısı önizlemede ve başlangıçta hesaplanır; aradaki fark izin değişikliğidir.

## Uçlar (`restaurants/:id/campaigns`, hepsi `@RequirePlanFeature('campaigns')`)

- `GET` (`campaigns.view`): liste; `GET audience`: toplam ve izinli müşteri sayısı.
- `POST` (`campaigns.manage`): taslak; `scheduledAt` verilirse doğrudan zamanlanır. `PATCH :id`: taslak veya zamanlanmış kampanyada ad, kanal, metin, segment.
- `POST :id/preview` (`campaigns.view`): alıcı sayısı, gereken kredi ve cüzdan bakiyesi, müşterinin göreceği örnek metin, şu an pencere içinde mi ve değilse ne zaman.
- `POST :id/send` (`campaigns.manage`): şimdi veya `scheduledAt`. `POST :id/cancel`.
- `GET :id`: kampanya ve ilk 500 alıcının durumu.
- Herkese açık: `POST /public/marketing/opt-out/:token` (oran sınırlı, idempotent).

## Ekranlar

- `/panel/<slug>/kampanyalar` (`campaigns.view`; Pro): yeni kampanya formu (ad, kanal, metin ve karakter sayacı, segment, isteğe bağlı zaman), önizleme kartı, liste ve sayaçlar, alıcı listesi, iptal. Temel planda plan kuralı ve Pro'ya geçiş bağlantısı.
- Vitrin: iletişim alanının altında izin kutusu (`shop.customer.marketingOptIn`), varsayılan işaretsiz.
- `/iptal/<token>`: bağlantıyı açmak vazgeçmektir; sayfa hangi restorandan çıkıldığını söyler.

## Kalan

- Gerçek İYS adaptörü ve İYS kayıt zorunluluğu belgesi; GDPR bölgeleri için eşdeğer sicil yok, yalnızca izin ve vazgeçme uygulanır.
- Segment kaydetme (B2'nin kalan parçası), e-posta kanalı. Sadakat programı `docs/SADAKAT.md` ile geldi.
