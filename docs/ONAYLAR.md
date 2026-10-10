# Gönderim onayı, gönderim sınırları ve denetim kayıtları

Platformun kendi pazarlama gönderimleri (ve isteyen her işletmenin kampanyaları ve otomatik akışları) için üç güvence: dört göz onayı, alıcı sınırları ve denetim kayıtlarının konsolda okunması. Sözleşmeler `packages/shared/src/approvals.ts` içindedir.

| Parça | Anahtar | Kapsam |
| --- | --- | --- |
| Gönderim onayı ve sınırları | `marketing_approvals` (varsayılan kapalı, BETA) | Kiracı başına; önce platform kiracısında açılması önerilir |
| Denetim kayıtları görüntüleyici | `audit_viewer` (varsayılan kapalı, BETA) | Konsol; genel anahtarla açılır |

## Dört göz onayı

Modül bir kiracıda açıkken kampanya, onu onaya gönderen kişiden **başka** bir yetkili onaylamadan gönderilemez ve zamanlanamaz.

- **İzin**: `campaigns.approve` (yeni). Platform kiracısında yalnızca `platform.marketing.send` bu izni verir; yani pazarlama yöneticisi onaylar, editör hazırlar ve onaya gönderir. Restoranlarda sahip her izne sahiptir; modül açıksa ikinci bir kişiye `campaigns.approve` içeren bir rol verilmelidir. Mevcut platform yöneticisi rol şablonlarına izin `20261114000002_platform_campaign_approve` migration'ıyla eklenir.
- **Akış**:
  1. Kampanya taslak olarak kaydedilir. Modül açıkken oluştururken zamanlama verilirse `CAMPAIGN_APPROVAL_REQUIRED`.
  2. `POST :id/approval/request` (`campaigns.manage`): taslak, onay yoksa veya reddedildiyse `PENDING` olur.
  3. `POST :id/approval/approve` veya `POST :id/approval/reject { note }` (`campaigns.approve`): isteyen kişi kendi isteğine karar veremez (`APPROVAL_SELF_FORBIDDEN`). Karar koşullu güncellemeyle yazılır; aynı anda iki karar verilemez. Ret gerekçesi zorunludur ve kampanyada görünür.
  4. `POST :id/send` yalnızca `APPROVED` kampanyada çalışır, aksi halde `CAMPAIGN_APPROVAL_REQUIRED`. Onaylayan kişi `campaigns.manage` sahibi değilse gönderemez; gönderim yine hazırlayan tarafındadır.
- **İçerik değişirse onay düşer**: onaylı, bekleyen veya reddedilmiş bir kampanyada yapılan her düzenleme onayı `NONE` durumuna döndürür; modül açıksa zamanlanmış kampanya da taslağa döner. Onay, kampanyanın metni ve hedef tanımı içindir; kayıtlı bir dinamik segmentin kuralı sonradan değişirse onay düşmez (segment düzenlemesi kendi denetim kaydını taşımaz, bu bilinçli bir sınırdır).
- **Başlangıçta yeniden kontrol**: çalıştırıcı zamanı gelen kampanyayı başlatırken modül açıksa onayı ve sınırları yeniden denetler. Modül açılmadan önce kuyruğa girmiş veya kitlesi büyümüş kampanya taslağa döner (`lastError`: `CAMPAIGN_APPROVAL_REQUIRED` veya `SEND_LIMIT_EXCEEDED`) ve `campaign.held` kaydı yazılır.

## Otomatik akışlarda onay

Otomatik akışlar (`docs/AKISLAR.md`) aynı ticari göndericiden geçtiği için modül açıkken aynı dört göz kuralına tabidir. Akış kampanya gibi bir kez değil sürekli gönderdiği için onay, akışın **o anki içeriğine** verilir:

- **Onay ne zaman istenir**: modül açıkken akışı açmak (`PATCH :id { status: 'ACTIVE' }`) veya açık bir akışın içeriğini değiştirmek onayı kendiliğinden `PENDING` yapar (isteyen, işlemi yapan kişidir). İçerik: kanal, konu, metin, gecikme, siparişsiz gün, tekrar aralığı ve segment. Ad ve dönüşüm penceresi içerik sayılmaz.
- **İçerik değişirse onay düşer**: modülden bağımsız olarak her içerik değişikliği onayı geri alır (`NONE`; akış açıksa ve modül açıksa hemen yeniden `PENDING`). Akış, içeriği son değiştiren kişiyi ve zamanı tutar (`contentUpdatedByUserId`, `contentUpdatedAt`).
- **Karar**: `POST /restaurants/:id/journeys/:journeyId/approval/approve` veya `.../approval/reject { note }` (`campaigns.approve`, modül kapalıyken `FEATURE_DISABLED`). İçeriği son değiştiren kişi karar veremez (`APPROVAL_SELF_FORBIDDEN`); sahibi her izne sahip olsa da kendi yazdığı akışı onaylayamaz. Karar `NONE` veya `PENDING` durumdaki akışa verilir, aksi halde `JOURNEY_STATE_INVALID`. Karar, okunan onay durumu ve içerik zamanıyla koşullu yazılır: aynı anda iki karar verilemez, arada değişen içerik görülmeden onaylanmaz. Reddedilen akış, düzenlendiğinde veya duraklatılıp yeniden açıldığında yeniden onaya düşer.
- **Çalıştırıcı**: modül açıkken onaysız akış göndermez ve geri kazanım taraması yapmaz; kayıtlar bekler, akışın `lastError` alanında `JOURNEY_APPROVAL_REQUIRED` görünür ve `journey.held` kaydı yazılır. Modül açılmadan önce açılmış akışlar da onaylanana kadar bu şekilde durur. Onay verildiğinde geri kazanım taraması bir sonraki geçişte yapılır.
- **Ekran**: modül açıkken akış listesinde onay durumu, isteyen ve karar veren, ret gerekçesi görünür; `campaigns.approve` sahibi `NONE` veya `PENDING` akışta "Onayla" ve gerekçeli "Reddet" görür. Platform kiracısında, kampanyalarda olduğu gibi, modül açıkken editör (`platform.marketing.manage`) akış hazırlar ve açar, gönderim için pazarlama yöneticisinin (`platform.marketing.send`) onayı gerekir.

## Gönderim sınırları

Süper admin kiracı başına iki sınır belirler (`campaign_send_limits`, boş = sınır yok):

- **Kampanya başına en fazla alıcı**.
- **Son 24 saatte en fazla alıcı**: son 24 saat içinde başlamış kampanyaların alıcı sayıları ile son 24 saatte gönderilmiş otomatik akış mesajlarının toplamı, yeni kampanyanın kitlesiyle birlikte bu sınırı aşamaz. Pencere kayan pencere olduğu için bir saat dilimine göre gece yarısı sıfırlanmaz.

Otomatik akışlar sınırlı bir kitleye bir kez gitmediği için kampanya başına sınır akışlara uygulanmaz; her akış mesajı 24 saatlik sınırdan bir alıcı düşer. Sınıra ulaşıldığında çalıştırıcı akışı tutar (kayıtlar bekler, `lastError`: `SEND_LIMIT_EXCEEDED`, `journey.held` kaydı) ve pencere ilerledikçe kaldığı yerden devam eder.

Sınırlar modül açıkken uygulanır. Gönderim isteğinde kitle o anki kurallarla sayılır; sınır aşılırsa `SEND_LIMIT_EXCEEDED` ve `campaign.limit_blocked` kaydı. Önizleme (`guards`) onay durumunu, sınırları, son 24 saatte kullanılanı ve aşılacak sınırı gösterir; ekran bu durumda gönder düğmesini kapatır. Sınırlar ticari ileti izni, sessiz saat ve sıklık kurallarının (`docs/RIZA.md`) yerine geçmez, onlara eklenir.

Konsol uçları: `GET /admin/send-limits/:restaurantId`, `PUT /admin/send-limits/:restaurantId { maxPerCampaign, maxPerDay }` (`send_limit.update` kaydı). Ekran: konsolda Pazarlama sayfası, platform kiracısı için "Gönderim sınırları" kartı.

## Denetim kayıtları

Kampanya işlemleri her kiracıda, modülden bağımsız olarak denetim kaydına yazılır:

| İşlem | Ne zaman |
| --- | --- |
| `campaign.create` | Kampanya oluşturuldu |
| `campaign.update` | Düzenlendi (değişen alanlar, düşen onay, taslağa dönüş) |
| `campaign.approval.request` / `.approve` / `.reject` | Onay isteği ve karar (ret gerekçesiyle) |
| `campaign.send` | Kuyruğa alındı (kitle, zaman) |
| `campaign.limit_blocked` | Sınır nedeniyle reddedildi |
| `campaign.held` | Çalıştırıcı başlangıçta durdurdu (sistem) |
| `campaign.cancel` | İptal edildi |
| `send_limit.update` | Konsol sınırları değiştirdi |

Otomatik akış işlemleri de her kiracıda, modülden bağımsız olarak yazılır (varlık `journey`):

| İşlem | Ne zaman |
| --- | --- |
| `journey.create` | Akış oluşturuldu |
| `journey.update` | Düzenlendi (alanlar, değişen içerik, düşen onay) |
| `journey.activate` / `journey.pause` | Açıldı veya duraklatıldı |
| `journey.approval.request` / `.approve` / `.reject` | Onay isteği (açma veya içerik değişikliğiyle) ve karar (ret gerekçesiyle) |
| `journey.held` | Çalıştırıcı onay veya 24 saatlik sınır nedeniyle durdurdu (sistem, gerekçe başladığında bir kez) |
| `journey.delete` | Akış silindi |

`/admin/denetim` (konsol, `audit_viewer` genel anahtarı açıkken) tüm denetim kayıtlarını en yeniden başlayarak 50'lik sayfalarla gösterir: zaman, işlem ve varlık, işletme, yapan kişi ve ayrıntı (JSON metni, düz metin olarak). Filtreler: işletme adresi (slug), işlem öneki (`campaign.`, `journey.`, `platform.user` gibi; yalnızca küçük harf, rakam, nokta, alt çizgi), başlangıç ve bitiş günü (UTC). "Platform gönderimleri" düğmesi platform kiracısını ve `campaign.` önekini seçer. Kayıtlar yalnızca okunur; ekranda değiştirme veya silme yoktur.

API: `GET /admin/audit?restaurant=&action=&from=&to=&page=` (`@SuperAdminOnly()`, anahtar kapalıyken `FEATURE_DISABLED`).

## Veri

`campaigns` tablosuna onay alanları (`approvalStatus` NONE / PENDING / APPROVED / REJECTED, isteyen, karar veren, zamanlar, gerekçe), `campaign_send_limits` tablosu ve `audit_logs.createdAt` dizini. Migration'lar: `20261114000000_campaign_approvals`, `20261114000001_audit_log_time_index`, `20261114000002_platform_campaign_approve` (yalnızca ekleme).

`journeys` tablosuna aynı onay alanları ile içeriği son değiştiren kişi ve zaman (`contentUpdatedByUserId`, `contentUpdatedAt`; mevcut akışlarda oluşturan kişi ve son güncelleme zamanıyla doldurulur), `journey_runs` üzerinde `journeyId + sentAt` dizini (24 saatlik sayım). Migration: `20261214000000_journey_approvals` (yalnızca ekleme; yeni sütunlar boş bırakılabilir veya varsayılanlıdır).

## Testler

- `packages/shared/src/approvals.spec.ts`: sınır hesabı, sınır ve denetim sorgusu doğrulaması.
- `apps/api/test/e2e/approvals.e2e-spec.ts`: modül kapalıyken davranış, zamanlama reddi, onaysız gönderim reddi, kendi isteğini onaylama reddi, ret ve yeniden istek, onaylayanın gönderememesi, düzenlemeyle onayın düşmesi, kampanya başına ve 24 saatlik sınır, modül açılmadan kuyruğa girmiş kampanyanın tutulması, denetim görüntüleyicisinin anahtarı, yetkisi, filtreleri ve kayıtları.
- `apps/api/test/e2e/journey-approvals.e2e-spec.ts`: modül kapalıyken karar uçlarının reddi; modül açıkken açılan akışın onaysız göndermemesi, yazarın kendi akışını onaylayamaması, onaydan sonra gönderim; akış mesajlarının 24 saatlik sınıra sayılması, sınırda tutma ve sınır yükselince devam (kampanya başına sınır akışa uygulanmaz); açık akışta içerik değişince onayın düşmesi, ret, ad değişikliğinin onayı düşürmemesi, yeniden açınca yeniden onay; `journey.*` denetim kayıtları.
- `apps/web/e2e/approvals.e2e.ts`: konsolda sınır kartı ve denetim kayıtları.
