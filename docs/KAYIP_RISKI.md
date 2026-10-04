# Kayıp riski sinyalleri

İki tarafı vardır: restoranın kendi müşterilerinden hangilerinin uzaklaştığını görmesi ve platform sahibinin hangi restoranların platformdan uzaklaştığını konsolda görmesi. Hesaplar `packages/shared/src/churn.ts` içindedir; API ve web aynı fonksiyonları kullanır.

| Taraf | Anahtar | Varsayılan | Plan |
| --- | --- | --- | --- |
| Müşteri kayıp riski (panel, segment alanı) | `churn_signals` | kapalı (BETA) | PRO analitik (`@RequirePlanFeature('analytics')`) |
| Restoran sağlığı (konsol) | `restaurant_health` | kapalı (BETA), genel anahtarla açılır | yok (yalnızca süper admin) |

## Müşteri sınıfları

Her müşteri sabit bir gün sayısına göre değil, **kendi sipariş aralığına** göre değerlendirilir. Olağan aralık, ilk ve son sipariş arasındaki sürenin sipariş aralığı sayısına bölümüdür (`(sonSipariş - ilkSipariş) / (siparişSayısı - 1)`, en az 1 gün). Haftada bir gelen müşteri iki sessiz haftadan sonra riskte sayılır; ayda bir gelen müşteri aynı sürede düzenli kalır.

| Sınıf | Kural |
| --- | --- |
| `NEW` (Yeni) | Tek sipariş, üzerinden en çok 30 gün geçmiş |
| `NOT_RETURNED` (Dönmedi) | Tek sipariş, 30 günden fazla ama en çok 90 gün önce |
| `ACTIVE` (Düzenli) | En az iki sipariş, sessizlik "riskte" eşiğini aşmamış |
| `AT_RISK` (Riskte) | Sessizlik `max(14, 2 x olağan aralık)` günü aşmış |
| `LOST` (Kayıp) | Sessizlik `max(90, 4 x olağan aralık)` günü aşmış |

Hiç sipariş vermemiş kişinin (CRM adayı) sınıfı yoktur. Sabitler `CHURN_*` adlarıyla paylaşılan pakettedir; değiştirmek bu dokümanı ve testleri birlikte değiştirmeyi gerektirir.

### Saklama ve güncelleme

Sınıf, segmentlerin onu hedefleyebilmesi için müşteri satırında saklanır (`restaurant_customers.churnRisk`):

- **Sipariş**: sipariş yerleştirildiği anda müşterinin sınıfı yeniden hesaplanır; riskteki veya kayıp müşteri yeni siparişiyle düzenli (veya ilk siparişse yeni) olur.
- **Tarama**: günler geçtikçe sınıflar kendiliğinden değişir. API içindeki `ChurnSweepWatchdog` açılıştan 5 dakika sonra ve sonra her 6 saatte bir tüm müşterileri 1000'lik sayfalarla tarar ve yalnızca sınıfı değişen satırları günceller. Tarama tekrarlanabilir (idempotent); ikinci bir sunucu örneğinin aynı işi yapması yalnızca sorgu maliyetidir. Testlerde ve `ORDER_WATCHDOG=off` iken kapalıdır.
- **Panel**: kayıp riski ekranı açılırken önce o restoranın müşterileri taranır; ekran her zaman güncel sınıfları gösterir.

Sınıflar modül kapalıyken de hesaplanmaya devam eder (yalnızca restoranın kendi verisinden türetilir, dışarı gitmez); modül ekranı ve segment alanını açar.

### Panel

`/panel/<slug>/kayip-riski` (`customers.view`, modül açık, PRO):

- Sınıf başına müşteri sayısı ve riskteki müşterilerin bugüne kadarki sipariş toplamı (geri kazanımın koruduğu değer).
- Geri kazanılacak müşteriler: Riskte, Dönmedi ve Kayıp sekmeleri; her sekmede en değerli 100 müşteri (ömür boyu tutara göre). Satırda sipariş sayısı, son sipariş ve kaç gün önce olduğu, olağan aralık, toplam tutar ve ticari ileti izni durumu görünür. Telefon yalnızca `customers.contact.view` izni olan kullanıcıya gösterilir; silinmiş hesaplar listelenmez.
- Segmentler modülü açıksa ve kullanıcı kampanyaları görebiliyorsa, segment ekranına bağlantı.

API: `GET /restaurants/:restaurantId/churn/overview`, `GET /restaurants/:restaurantId/churn/customers?risk=AT_RISK|NOT_RETURNED|LOST` (`@RequireFeature('churn_signals')`, `@RequirePlanFeature('analytics')`, `@RequirePermission('customers.view')`).

### Segment alanı

Segmentler (`docs/SEGMENTLER.md`) `churnRisk` liste alanını tanır (`in`, `notIn`; `notIn` sınıfı olmayan adayları da kapsar). Kural kurucu alanı yalnızca modül açıkken gösterir; API, modül kapalıyken bu alanı içeren yeni kural, kural değişikliği veya önizlemeyi `FEATURE_DISABLED` ile reddeder. Daha önce kaydedilmiş bir segment modül sonradan kapatılsa da saklı sınıfla çalışmaya devam eder. Kampanya ve akışlar segment üzerinden hedeflendiği için ticari ileti izni, sessiz saat ve sıklık sınırları (`docs/RIZA.md`) aynen uygulanır; kayıp riski hiçbir izni aşmaz.

## Restoran sağlığı (konsol)

`/admin/saglik` etkin restoranları (platform kiracısı hariç) belirtilere göre sıralar. Sipariş sayımında ödeme bekleyen, reddedilen ve iptal edilen siparişler sayılmaz.

| Belirti | Kural | Ağırlık |
| --- | --- | --- |
| `SILENT` | Daha önce sipariş almış, en az 7 gündür sipariş yok | 3 |
| `PAYMENT_OVERDUE` | Vadesi geçmiş komisyon faturası var | 3 |
| `ORDER_DROP` | Önceki 14 günde en az 10 sipariş, son 14 günde bunun yarısı veya daha azı (sessiz değilse) | 2 |
| `NEVER_ORDERED` | Kayıttan en az 14 gün sonra hâlâ ilk sipariş yok | 2 |
| `LISTING_SUSPENDED` | Pazaryeri listelemesi askıda | 2 |
| `TRIAL_ENDING` | Deneme süresi 7 gün içinde bitiyor ve kayıtlı fatura kartı yok | 1 |

Ağırlıkların toplamı seviyeyi belirler: 3 ve üzeri yüksek, 2 orta, 1 düşük. Belirtisi olmayan restoran listede yer almaz. Ekran restoran detayına bağlantı verir; müdahale (arama, deneme uzatma, fatura takibi) mevcut konsol araçlarıyla yapılır.

API: `GET /admin/restaurant-health` (`@SuperAdminOnly()`; genel `restaurant_health` anahtarı kapalıyken `FEATURE_DISABLED`).

## Veri

`restaurant_customers.churnRisk` (`ChurnRisk` enum: `NEW`, `ACTIVE`, `NOT_RETURNED`, `AT_RISK`, `LOST`; boş olabilir) ve `restaurantId + churnRisk` dizini. Migration: `20261113000000_churn_risk` (yalnızca ekleme; mevcut satırlar ilk taramada dolar).

## Testler

- `packages/shared/src/churn.spec.ts`: tek siparişli müşterinin yolu, haftalık ve aylık ritim, aynı gün siparişleri, restoran belirtileri ve seviyeler.
- `apps/api/test/e2e/churn.e2e-spec.ts`: panel ve segment için modül anahtarı, ritme göre sınıflar, liste ve telefon, segment önizlemesi, siparişle sınıfın sıfırlanması, konsol anahtarı ve yetkisi, ilk siparişi gelmeyen restoran.
- `apps/web/e2e/churn.e2e.ts`: kapalıyken 404, sınıf sayıları ve riskteki müşteri, konsolda restoran sağlığı.
