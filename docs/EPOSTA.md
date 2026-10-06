# E-posta kanalı

Restoran, alan adının SPF, DKIM ve DMARC kayıtları yayınlandıktan sonra kendi alan adından e-posta gönderir. Doğrulanana kadar yalnızca işlemsel e-postalar platformun adresinden, restoranın adıyla gider. Geri dönen (adres yok) bir adres herkes için, şikayet eden veya istemediğini söyleyen bir adres o gönderici için susturulur. E-posta ölçülmez; kredi düşülmez. Pazarlama yönetim paketi yol haritasının 5. maddesidir (`docs/PAZARLAMA.md`). E-posta kampanyaları 7. maddededir. Kardeş platformdaki SES ve DNS kalıbı örnek alınmıştır; o depoya dokunulmaz.

`email_channel` modül anahtarının arkasındadır (varsayılan kapalı, BETA).

## Sağlayıcı

- `EMAIL_PROVIDER=SES`: Amazon SES (API v2, `@aws-sdk/client-sesv2`). `SES_REGION` ve `SES_FROM_ADDRESS` zorunludur. Kimlik bilgileri SDK'nın varsayılan zincirinden gelir: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` veya sunucu rolü; kodda gizli bilgi yoktur. İsteğe bağlı `SES_CONFIGURATION_SET`.
- `EMAIL_PROVIDER=MOCK` (varsayılan): geliştirme ve testte gönderilmiş sayar ve gönderileni bellekte tutar. Üretimde reddeder (`EMAIL_NOT_CONFIGURED`), böylece eksik yapılandırma hiçbir zaman teslim edilmiş gibi görünmez. Panelde "sağlayıcı yapılandırılmadı" uyarısı çıkar.
- Gönderici adının Türkçe harfleri RFC 2047 ile kodlanır.

## Gönderici alan adı

1. **Ekleme:** restoran alan adını, gönderen adresinin @ öncesini ve gönderen adını girer. Sağlayıcıda alan adı kimliği oluşturulur ve üç Easy DKIM belirteci alınır.
2. **Yayınlanacak kayıtlar** (`expectedEmailDomainRecords`):
   - SPF: alan adında `v=spf1 include:amazonses.com ~all`;
   - DKIM: üç CNAME, `<belirteç>._domainkey.<alan adı>` -> `<belirteç>.dkim.amazonses.com`;
   - DMARC: `_dmarc.<alan adı>` üzerinde `v=DMARC1; p=none; ...`, herhangi bir geçerli `p=` olur.
3. **Denetleme:** "DNS kayıtlarını denetle" düğmesi kayıtları okur (`evaluateEmailDomainDns`, saf ve birim testli). Kayıt başına durum `VALID`, `INVALID` (yanlış değer) veya `MISSING` olur.
4. **Sonuç:**
   - üçü de geçerliyse alan adı `VERIFIED` olur;
   - daha önce doğrulanmış bir alan adı bozulursa `FAILED` olur ve ticari gönderim durur.
5. **Sahiplik ve sınırlar:**
   - bir alan adı yalnızca bir kiracıya ait olabilir (`EMAIL_DOMAIN_TAKEN`);
   - platformun kendi alan adı ve alt alan adları kabul edilmez (`EMAIL_DOMAIN_RESERVED`);
   - alan adı kaldırılınca sağlayıcıdaki kimlik de silinir.

DNS okuyucusu, özel alan adlarıyla aynı anahtarla seçilir (`DOMAIN_VERIFIER`). Testlerde `MOCK`: `.verified.test` altındaki alan adları istenen her kaydı yayınlamış sayılır.

## Gönderim kuralları (`EmailService.send`)

Her denemede bir `message_logs` satırı yazılır (kanal `EMAIL`, maskeli adres, kredi 0). Sırasıyla:

1. **Adres:** geçerli olmalı (`INVALID_EMAIL`).
2. **Bastırma listesi:**
   - adres herhangi bir gönderici için geri döndüyse `SUPPRESSED_BOUNCE`;
   - bu gönderici için şikayet ettiyse veya istemiyorsa `SUPPRESSED_COMPLAINT` / `SUPPRESSED_UNSUBSCRIBE`.

   Gönderim yapılmaz.
3. **Ticari e-posta** (`COMMERCIAL`):
   - göndericinin doğrulanmış alan adı olmalı (`EMAIL_DOMAIN_NOT_VERIFIED`);
   - kişinin EMAIL kanalında geçerli izni olmalı (rıza v2, `docs/RIZA.md`);
   - `List-Unsubscribe` ve `List-Unsubscribe-Post: List-Unsubscribe=One-Click` başlıkları eklenir;
   - altbilgide restoran adı, şube adresi ve abonelikten çıkma bağlantısı yer alır.
4. **İşlemsel e-posta:**
   - doğrulanmış alan adı varsa ondan, yoksa `SES_FROM_ADDRESS` adresinden gider;
   - gönderen adı restoranın adıdır;
   - altbilgide "bu e-posta {restoran} adına gönderildi" yazar.

Metinler i18n anahtarlarıdır (`email.template.<anahtar>.subject|body`, `email.footer.*`). Şablonlar: `test` (deneme), `campaign` (kampanya), `invoice.summary` ve `invoice.summarySettled` (sahibe aylık komisyon özeti, `docs/FATURALAMA.md`; platform adresinden giden işlemsel e-posta). HTML gövde düz metinden kaçışlanarak üretilir (`plainTextToHtml`); çeviri değerleri asla HTML olarak işlenmez.

## Bastırma listesi

| Neden | Kapsam | Kim kaldırır |
|---|---|---|
| `BOUNCE` (kalıcı geri dönme) | Herkes (`restaurantId` boş) | Yalnızca platform; panelde görünmez |
| `COMPLAINT` (istenmeyen bildirimi) | Mesajı gönderen kiracı | Kaldırılamaz (`SUPPRESSION_LOCKED`) |
| `UNSUBSCRIBE` (elle) | Kiracı | Kiracı |

Şikayet veya elle eklenen istemiyor kaydı, kiracının o e-posta adresine sahip kişilerinin EMAIL izni için de ret yazar. Geçici geri dönmeler kaydedilmez. Bastırma kayıtları "gönderme" talimatını yerine getirmek için tutulur, hesap silinse de kalır.

## Sağlayıcı geri bildirimi (SNS)

`POST /webhooks/email/ses` SES olaylarını SNS üzerinden alır. SNS gövdeyi `text/plain` olarak gönderir; ham gövde imza için saklanır.

- **Konu denetimi:** konu `SES_SNS_TOPIC_ARNS` listesinde değilse mesaj yok sayılır.
- **İmza denetimi:**
  - sertifika adresi HTTPS olmalı ve yalnızca Amazon'un SNS host'unda bulunmalı (`sns.<bölge>.amazonaws.com`);
  - imza sürümü 1 (SHA1) veya 2 (SHA256) olmalı;
  - imzalanan alanlar SNS sırasıyla doğrulanır;
  - doğrulanmayan mesaj düşürülür.
- **Abonelik onayı:** imzalı `SubscribeURL` yalnızca SNS host'undaysa çağrılır.
- **İşleme:** `Bounce` (yalnızca `Permanent`) genel bastırmaya, `Complaint` mesajı gönderen kiracıya yazılır. Kiracı, sağlayıcı mesaj kimliğinden (`message_logs.providerRef`) bulunur.

## Uçlar

| Uç | İzin |
|---|---|
| `GET /restaurants/:id/email` (alan adları, bastırma listesi, sağlayıcı durumu) | `integrations.manage` |
| `POST .../email/domains`, `POST .../domains/:domainId/verify`, `DELETE .../domains/:domainId` | `integrations.manage` |
| `POST .../email/suppressions`, `DELETE .../suppressions/:id` | `integrations.manage` |
| `POST .../email/test` (`to`) | `integrations.manage` |
| `POST /webhooks/email/ses` | imzalı SNS, istemci başına dakikada 600 |

Restoran uçları `email_channel` anahtarını ister.

## Ekran

Entegrasyon sayfasında "E-posta gönderici" kartı yer alır:
- alan adı ekleme;
- yayınlanacak DNS kayıtları tablosu (kayıt başına durum);
- denetleme ve kaldırma;
- deneme e-postası;
- gönderilmeyecek adresler listesi (ekleme, istemiyor kaydını çıkarma).

## Veri

`email_domains` (alan adı tekil, DKIM belirteçleri, kayıt durumları, DMARC politikası, son denetim ve doğrulama zamanı) ve `email_suppressions` (adres, neden, kiracı veya genel; kısmi tekil indeksler). Migration: `20261103000000_email_channel`.

## Sonraki adımlar

- Açılma ve tıklama ölçümü. E-posta kampanyaları kampanyalar v2 ile geldi (`docs/KAMPANYALAR.md`, `email.template.campaign`, tek tık çıkış adresi `/api/iptal/<token>`).
- E-posta ile çift onay.
- Özel MAIL FROM alt alan adı.
- Konsolda genel geri dönme listesi.
- Gelen e-posta cevaplarının gelen kutusuna alınması.
