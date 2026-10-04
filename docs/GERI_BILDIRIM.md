# Geri bildirim ve NPS

Müşterinin sipariş sonrası söylediklerini işe yarar hale getirir: düşük puan restorana takip edilecek bir kayıt olarak düşer, değerlendirme bağlantısı puan veren herkese gösterilir, takip sayfasında tek bir NPS sorusu sorulur. Modül `feedback` anahtarının arkasındadır (varsayılan kapalı, BETA) ve PRO analitiğin parçasıdır (`@RequirePlanFeature('analytics')`). Sipariş puanlamasının kendisi (`docs/VITRIN.md`, "Değerlendirme") modülden bağımsızdır.

## Değerlendirme daveti: herkese, puandan bağımsız

Restoran bir değerlendirme sayfası bağlantısı girer (örneğin Google işletme profilinin değerlendirme bağlantısı; yalnızca `https`, kullanıcı adı ve parola içeremez). Takip sayfası bu bağlantıyı **puan veren her müşteriye**, verdiği puana bakmadan gösterir.

Yalnızca memnun müşterilerden değerlendirme istemek ("review gating") Google'ın değerlendirme politikasına aykırıdır ve birçok ülkede tüketici mevzuatına göre yanıltıcı uygulama sayılır (örneğin ABD FTC'nin 2024 tarihli sahte değerlendirme kuralı değerlendirme bastırmayı yasaklar). Bu yüzden:

- Bağlantının gösterilmesi hiçbir koşulda puana bağlanmaz.
- Değerlendirme karşılığında indirim, puan, kupon veya başka bir teşvik verilmez; ürün bunu yapmanın bir yolunu sunmaz.
- Düşük puanın restorana ayrıca bildirilmesi (aşağıda) değerlendirme bağlantısını gizlemez.

## Düşük puan: takip kaydı ve bildirim

- Puan, restoranın seçtiği eşik veya altındaysa (varsayılan 2, en çok 3) bir **geri bildirim kaydı** açılır (`feedback_cases`, sipariş başına bir). Kayıt puanı ve yorumu taşır.
- Müşterileri gören personele (`customers.view` izni olan rolleri ve sahip) push bildirimi gider: "Düşük puan: sipariş <kod>". Bildirim uygulamayı açar; kayıt web panelinde işlenir.
- Panelde **Geri bildirim** sayfası (`/panel/<slug>/geri-bildirim`) açık kayıtları listeler. `customers.contact.view` izni olan müşterinin adını ve telefonunu görür (silinmiş hesaplarınki hiç görünmez). `customers.manage` izni olan not yazar, kaydı çözüldü olarak işaretler veya yeniden açar.
- Kayıt açılması puanlamayı hiçbir zaman başarısız kılmaz; bir hata yalnızca günlüğe yazılır.

## NPS

- Restoran açarsa, takip sayfası tamamlanmış siparişte, puanlama penceresi boyunca (`RATING_WINDOW_DAYS`) tek bir soru sorar: "Bu restoranı bir arkadaşınıza tavsiye etme olasılığınız nedir?" (0 ile 10) ve isteğe bağlı bir neden.
- Sipariş başına bir yanıt (`NPS_EXISTS`); pencere dışında veya modül kapalıyken `NPS_NOT_ALLOWED`.
- Hesaplama standarttır: 9 ve 10 tavsiye eden, 7 ve 8 kararsız, 0 ile 6 eleştiren; NPS = tavsiye eden yüzdesi eksi eleştiren yüzdesi, tam sayıya yuvarlanır (`npsScore()`).

## Özet

Panel sayfası seçilen dönem için (30, 90 veya 365 gün; `reports.view`) puan ortalamasını ve 1 ile 5 arası dağılımı, NPS'i ve kırılımını, son NPS yorumlarını ve açık kayıt sayısını gösterir.

## Ayarlar

| Ayar | Varsayılan | İzin |
| --- | --- | --- |
| Değerlendirme sayfası bağlantısı | yok | `restaurant.settings.manage` |
| Kayıt açılacak en yüksek puan | 2 | aynı |
| Takip sayfasında NPS | kapalı | aynı |

## Kişisel veri

Hesap silinince sipariş değerlendirmelerinin yorumuyla birlikte geri bildirim kayıtlarındaki ve NPS yanıtlarındaki yorumlar da silinir; puanlar raporlar için kalır (`docs/KISISEL_VERI.md`).

## API

| Uç | İzin |
| --- | --- |
| `GET /restaurants/:id/feedback/settings` | `customers.view` |
| `PUT /restaurants/:id/feedback/settings` | `restaurant.settings.manage` |
| `GET /restaurants/:id/feedback/overview?days=` | `reports.view` |
| `GET /restaurants/:id/feedback/cases?status=` | `customers.view` |
| `PATCH /restaurants/:id/feedback/cases/:caseId` | `customers.manage` |
| `POST /public/orders/:token/nps` | Herkese açık, takip belirteciyle; oran sınırlı |

Takip yanıtına (`OrderTrackingDTO`) `reviewUrl`, `nps` ve `canAnswerNps` eklendi. Veri: `feedback_settings`, `feedback_cases`, `nps_responses`. Migration: `20261112000000_feedback_nps`.

## Sonraki adımlar

- Uygulamada geri bildirim ekranı (bildirim bugün yalnızca uygulamayı açar).
- Platformun kendi NPS'i (restoranlara platform hakkında).
- Düşük puan kaydından müşteriye işlem mesajı (izin ve kanal kurallarıyla).
