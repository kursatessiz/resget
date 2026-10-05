# İleri tarihli sipariş

Müşteri siparişini şimdi verir, ama çalışma saatleri içinden daha sonraki bir saat seçer: bu akşam sekiz veya yarın öğlen. İşletme kapalıyken de ön sipariş alınır. Modül `scheduled_orders` anahtarının arkasındadır (varsayılan kapalı, BETA); kurallar `packages/shared/src/scheduling.ts` içindedir.

## İşletme ayarları

Panelde **Ayarlar > İleri tarihli sipariş** kartından (`GET` / `PUT /restaurants/:id/scheduling`, `restaurant.settings.view` / `restaurant.settings.manage`, anahtar gerekir). Her değişiklik denetim kaydına yazılır (`scheduling.update`). Ayarlar `restaurants.schedulingSettings` alanında tutulur; okunamayan değer varsayılanlara (kapalı) döner.

| Ayar | Varsayılan | Anlamı |
| --- | --- | --- |
| `enabled` | kapalı | İşletme sipariş sayfasında saat sunar |
| `slotMinutes` | 30 | Saat aralığı: 15, 30 veya 60 dakika |
| `minLeadMinutes` | 45 | İlk saat siparişten en az bu kadar sonradır (15 ile 1440 dakika arası) |
| `maxDaysAhead` | 2 | Son saat en çok bu kadar gün sonradır (1 ile 7 arası) |
| `deliveryLeadMinutes` | 20 | Teslimatta seçilen saat varış saatidir; sipariş bu kadar önce hazır olmalıdır |

## Saatler

`scheduledSlots()` saatleri işletmenin saat diliminde üretir:

- **Başlangıç:** şimdiden en az `minLeadMinutes` sonra, yerel saatte aralığın katına denk gelen ilk dakika. Örneğin 30 dakikalık aralıkta 12:05 değil 12:30. Çeyrek saatlik farkı olan saat dilimlerinde de yerel saat esas alınır.
- **Bitiş:** şimdiden `maxDaysAhead` gün sonrası. Liste en çok 400 saat içerir.
- **Çalışma saatleri:** her saat siparişin şubesinin çalışma saatleri içinde olmalıdır; kapanış saati dahil değildir. Saat girilmemiş şube her zaman açık sayılır.

Sipariş sayfasının menü yanıtında `scheduling` alanı (saatler ve saat dilimi) bulunur. Masa siparişinde bu alan yoktur; masaya sipariş her zaman hemen içindir.

## Müşteri

- **Saat seçimi:** sipariş formunda "Ne zaman?" bölümünde "En kısa sürede" veya "İleri bir saat seç". Saatler gün başlıklarıyla listelenir ve işletmenin saat diliminde gösterilir.
- **Kapalıyken:** işletme şu anda sipariş almıyorsa (saat dışı) "En kısa sürede" kapalıdır ve ön sipariş notu görünür.
- **Teslimat ve gel-al:** teslimatta seçilen saat kapıya geliş, gel-alda hazır olma saatidir; form bunu açıklar.
- **İstek:** `scheduledFor` alanıyla gönderilir. Saat, o anda sunulan saatlerden biri olmalıdır; değilse `400 SCHEDULED_SLOT_INVALID` döner. Modül kapalıysa veya işletme saat sunmuyorsa `409 SCHEDULING_UNAVAILABLE` döner.
- **Saat dışı ve duraklatma:** ön sipariş saat dışında da alınır. Duraklatma seçilen saati aşıyorsa `409 RESTAURANT_NOT_ACCEPTING` ile reddedilir.
- **Takip:** takip sayfası planlanan saati gösterir.

## İşletme tarafı

- **Durum:** sipariş hemen `PLACED` olur (önce ödemeli siparişte ödeme gelince). Sipariş kartında "İleri tarihli" rozeti saati gösterir.
- **Kabul alarmı:** kabul alarmı (`acceptDeadlineAt`) hazırlığa başlamadan bir zaman aşımı önce çalar (`scheduledAcceptDeadline()`). Bu, olağan zaman aşımından (yerleştirmeden sonra) hiçbir zaman önce değildir. Hazırlığa başlama zamanı = hazır olma zamanı eksi varsayılan hazırlık süresi; hazır olma zamanı = saat, teslimatta ise saat eksi teslimat payı. Örnek: saat 20:00, teslimat payı 20, hazırlık 20, zaman aşımı 10 dakika ise alarm 19:10'da çalar.
- **Kabul:** işletme siparişi saatinden önce istediği zaman kabul edebilir. Söz verilen hazır olma saati, saatin hazır olma zamanıdır; mutfak bu kadar hızlı yetişemiyorsa şimdi artı hazırlık süresidir (`scheduledPromisedReadyAt()`).
- **Personel siparişi:** personel de `scheduledFor` ile sipariş girebilir. Saatin gelecekte ve bir hafta içinde olması yeterlidir; personel saat listesine bağlı değildir.

## Veri

`orders.scheduledFor` (saat; hemen içinse boş, `restaurantId` ile dizinli) ve `restaurants.schedulingSettings`. Migration: `20261119000000_scheduled_orders`.

## Testler

- `packages/shared/src/scheduling.spec.ts`: ayarların okunması, kapalıyken boş liste, bekleme süresi ve yerel saat hizası, çalışma saatleri ve ufuk, saati girilmemiş şube, çeyrek saatlik saat dilimi, saat doğrulama, teslimat payı, kabul alarmı ve söz verilen saat.
- `apps/api/test/e2e/scheduled-orders.e2e-spec.ts`: modül anahtarı ve ayarlar, kapalıyken sunulan saatle ön sipariş, sunulmayan saatin ve hemen siparişin reddi, kabul alarmının saate göre konması, takip sayfasında saat, kabulde saatin söz verilmesi, saati aşan duraklatma, masa siparişinin zamanlanamaması.
- `apps/web/e2e/scheduled-orders.e2e.ts`: işletmenin ayarı açması, müşterinin saat seçip sipariş vermesi, takip sayfasında ve sipariş ekranında saatin görünmesi.
