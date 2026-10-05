# Gönderim onayı, gönderim sınırları ve denetim kayıtları

Platformun kendi pazarlama gönderimleri (ve isteyen her işletmenin kampanyaları) için üç güvence: dört göz onayı, alıcı sınırları ve denetim kayıtlarının konsolda okunması. Sözleşmeler `packages/shared/src/approvals.ts` içindedir.

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

## Gönderim sınırları

Süper admin kiracı başına iki sınır belirler (`campaign_send_limits`, boş = sınır yok):

- **Kampanya başına en fazla alıcı**.
- **Son 24 saatte en fazla alıcı**: son 24 saat içinde başlamış kampanyaların alıcı sayıları toplamı ile yeni kampanyanın kitlesi bu sınırı aşamaz. Pencere kayan pencere olduğu için bir saat dilimine göre gece yarısı sıfırlanmaz.

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

`/admin/denetim` (konsol, `audit_viewer` genel anahtarı açıkken) tüm denetim kayıtlarını en yeniden başlayarak 50'lik sayfalarla gösterir: zaman, işlem ve varlık, işletme, yapan kişi ve ayrıntı (JSON metni, düz metin olarak). Filtreler: işletme adresi (slug), işlem öneki (`campaign.`, `platform.user` gibi; yalnızca küçük harf, rakam, nokta, alt çizgi), başlangıç ve bitiş günü (UTC). "Platform gönderimleri" düğmesi platform kiracısını ve `campaign.` önekini seçer. Kayıtlar yalnızca okunur; ekranda değiştirme veya silme yoktur.

API: `GET /admin/audit?restaurant=&action=&from=&to=&page=` (`@SuperAdminOnly()`, anahtar kapalıyken `FEATURE_DISABLED`).

## Veri

`campaigns` tablosuna onay alanları (`approvalStatus` NONE / PENDING / APPROVED / REJECTED, isteyen, karar veren, zamanlar, gerekçe), `campaign_send_limits` tablosu ve `audit_logs.createdAt` dizini. Migration'lar: `20261114000000_campaign_approvals`, `20261114000001_audit_log_time_index`, `20261114000002_platform_campaign_approve` (yalnızca ekleme).

## Testler

- `packages/shared/src/approvals.spec.ts`: sınır hesabı, sınır ve denetim sorgusu doğrulaması.
- `apps/api/test/e2e/approvals.e2e-spec.ts`: modül kapalıyken davranış, zamanlama reddi, onaysız gönderim reddi, kendi isteğini onaylama reddi, ret ve yeniden istek, onaylayanın gönderememesi, düzenlemeyle onayın düşmesi, kampanya başına ve 24 saatlik sınır, modül açılmadan kuyruğa girmiş kampanyanın tutulması, denetim görüntüleyicisinin anahtarı, yetkisi, filtreleri ve kayıtları.
- `apps/web/e2e/approvals.e2e.ts`: konsolda sınır kartı ve denetim kayıtları.
