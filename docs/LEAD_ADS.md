# Lead Ads aday aktarımı

Facebook ve Instagram reklamlarındaki aday formlarını dolduran kişiler, işletmenin satış hattına kişi olarak eklenir. Bu, pazarlama yol haritasının 18. maddesinin ikinci adımıdır (`docs/ENTEGRASYON_MERKEZI.md`).

Modül `lead_ads` anahtarının arkasındadır (varsayılan kapalı, BETA). Entegrasyon merkezi (`integration_hub`) de açık olmalıdır, çünkü adaylar orada bağlanan Facebook sayfalarından gelir.

- Sözleşmeler: `packages/shared/src/lead-ads.ts`.
- API: `apps/api/src/modules/lead-ads`.

## Akış

1. **Sayfayı seçme:** İşletme, Entegrasyon sayfasında (`/panel/<slug>/entegrasyon`) veya platform için `/pazarlama/entegrasyonlar` ekranında bir Facebook sayfasını "Kullanılsın" ile açar. Ardından "Adayları al" kutusunu işaretler.
2. **Abonelik:** `PUT /restaurants/:id/lead-ads/pages/:accountId { enabled }` (`integrations.manage`) çağrılır. Açarken sayfa, sayfa anahtarıyla Meta'nın `leadgen` bildirimine abone edilir (`POST /{page-id}/subscribed_apps`).
   - Abonelik başarısız olursa `META_SUBSCRIBE_FAILED` (502) döner.
   - Instagram hesabı veya kullanımda olmayan bir sayfa için `LEAD_ADS_PAGE_REQUIRED` (409) döner.
   - Bir sayfa "Kullanılsın"dan çıkarılırsa aday alımı da kapanır.
3. **Bildirim:** Biri formu doldurduğunda Meta `POST /webhooks/meta` adresine imzalı bir bildirim yollar. Bildirimde yalnızca aday kimliği, sayfa, form ve reklam kimlikleri bulunur.
4. **Kayıt:** Bildirimdeki her aday, sayfayı bağlamış ve aday alımını açmış her kiracı için `meta_leads` tablosuna yazılır (kiracı ve aday kimliği başına tek satır). Aynı bildirimin tekrarı yeni satır açmaz.
5. **Aktarım:** Cevaplar sayfa anahtarıyla Graph API'den okunur (`GET /{leadgen-id}?fields=field_data,form_id,ad_id`) ve kişiye dönüşür:
   - Telefon kiracının ülkesine göre E.164'e çevrilir. Geçerli telefonu olmayan aday `SKIPPED` (`NO_PHONE`) olur, çünkü kullanıcılar telefonla tanımlanır.
   - **Yeni kişi:** satış hattının ilk açık aşamasında başlar. Kaynağı `meta_lead_ad` olur; ad, e-posta, şehir ve şirket formdan alınır.
   - **Mevcut kişi:** aynı telefonla zaten kişi varsa aşaması, kaynağı ve izinleri değişmez; yalnızca boş olan e-posta, şehir ve şirket alanları doldurulur.
   - Formdaki özel sorular ve cevapları kişinin geçmişine `FORM` etkinliği olarak düz metin yazılır. Telefon ve e-posta etkinliğe yazılmaz.
   - Platform kiracısında aday ayrıca `lead` dönüşümü olarak kaydedilir (`docs/ATIF.md`).
6. **Liste:** Entegrasyon ekranındaki "Lead Ads adayları" kartı, adayların geliş zamanını, oluşan kişiyi, sayfayı ve durumu gösterir (`GET /restaurants/:id/lead-ads/leads`, `customers.view`). "Satış hattında aç" bağlantısı kişilerin çalışıldığı ekrana gider.

## Durumlar

| Durum | Anlamı |
| --- | --- |
| `RECEIVED` | Kaydedildi, aktarılıyor veya bir sonraki denemeyi bekliyor |
| `IMPORTED` | Kişi oluştu veya güncellendi |
| `SKIPPED` | Formda geçerli telefon yok (`NO_PHONE`) veya modül kapalı (`MODULE_OFF`) |
| `FAILED` | Sayfa bağlantısı kaldırılmış ya da kapalı (`PAGE_UNAVAILABLE`), veya Graph API beş denemede yanıt vermedi (`GRAPH_ERROR`) |

## Yeniden deneme

- **Otomatik:** Graph okuması başarısız olursa aday `RECEIVED` kalır ve 2, 4, 8 ve 16 dakika sonra yeniden denenir. Denemeleri `LeadAdsWatchdog` iki dakikada bir tarar. Beşinci başarısız denemeden sonra aday `FAILED` olur.
- **Elle:** `FAILED` veya `SKIPPED` bir aday ekrandan "Yeniden dene" ile tekrar denenebilir (`POST .../leads/:leadId/retry`, `integrations.manage`). Aktarılmış aday için `LEAD_NOT_RETRYABLE` döner.
- **Çakışma:** her aktarım, adayı atomik olarak beş dakikalığına kiralar. Böylece bildirim ve tarama aynı adayı iki kez aktarmaz; birden fazla sunucu örneği de güvenlidir.

## İzin (rıza)

Aday formu pazarlama izni vermez. Meta formundaki onay metni işletmenin izin kaydı değildir (`docs/RIZA.md`). Bu yüzden kişi izinsiz oluşur: `marketingOptIn` kapalıdır ve kanal izni boştur. Kampanya göndermeden önce izin ayrıca alınmalıdır. Ekrandaki açıklama bunu söyler.

## Güvenlik

- **İmza:** her bildirim, `X-Hub-Signature-256` başlığı ham gövdenin `META_APP_SECRET` ile HMAC-SHA256 özetiyle sabit zamanlı karşılaştırıldıktan sonra okunur. İmzasız, yanlış imzalı veya biçimsiz bildirim `WEBHOOK_INVALID` (400) ile reddedilir. `META_APP_SECRET` yoksa hiçbir bildirim kabul edilmez.
- **Kurulum doğrulaması:** `GET /webhooks/meta?hub.mode=subscribe&hub.verify_token&hub.challenge` yalnızca `META_WEBHOOK_VERIFY_TOKEN` eşleşirse ve challenge yalnızca rakamlardan oluşuyorsa (en çok 15 hane) onu düz metin olarak döner, aksi halde 403 döner. Tekrarlanan parametreler yok sayılır.
- **Graph kimlikleri:** yalnızca rakamlardan oluşan kimlikler istek yoluna girer.
- **Veri saklama:** cevaplar `meta_leads` tablosunda saklanmaz; yalnızca kimlikler ve durum tutulur.
- **Oran sınırı:** dakikada 600 bildirim.
- **Denetim kaydı:** aday alımını açma ve kapama (`lead_ads.enable`, `lead_ads.disable`).

## Meta uygulaması kurulumu

1. Meta uygulamasında Webhooks ürününde `Page` nesnesi için geri çağırma adresi olarak `<PUBLIC_API_URL>/webhooks/meta` girilir.
2. Doğrulama anahtarı olarak `META_WEBHOOK_VERIFY_TOKEN` değeri girilir.
3. `leadgen` alanına abone olunur.
4. `leads_retrieval` ve `pages_manage_metadata` izinleri App Review'dan geçmelidir (`docs/ENTEGRASYON_MERKEZI.md`).
5. Sayfa yöneticisinin, Meta İş Yöneticisi'nde uygulamaya aday erişimi vermesi gerekebilir (Leads Access Manager).

## Sağlayıcı

`META_PROVIDER=MOCK` iken Graph çağrıları taklit edilir. Abonelik her zaman başarılıdır. Aday cevapları şöyledir:

| Aday kimliği | Cevap |
| --- | --- |
| 900000 - 900999 | Tam form (ad, kimliğe göre telefon, e-posta, şehir, bir özel soru) |
| 910000 - 910999 | Telefonsuz form |
| Diğerleri | Graph hatası |

## Testler

- `packages/shared/src/lead-ads.spec.ts`:
  - Alan eşleme: standart alanlar, kiracı ülkesine göre telefon, ad ve soyadın birleşmesi, geçersiz telefon ve e-posta, sınırlar.
  - Bildirimden aday çıkarma.
  - Geri çekilme süreleri.
- `apps/api/src/modules/social/meta-graph.spec.ts`:
  - Abonelik çağrısı ve aday okuma.
  - Rakam olmayan kimliğin isteğe girmemesi.
- `apps/api/test/e2e/lead-ads.e2e-spec.ts`:
  - Modül anahtarı ve kurulum doğrulaması.
  - Sayfa kuralı ve abonelik.
  - İmzasız ve yanlış imzalı bildirimin reddi.
  - İzinsiz kişi, ilk aşama, `FORM` etkinliği ve tek seferlik aktarım.
  - Mevcut kişinin korunması.
  - Telefonsuz aday.
  - Geri çekilmeli yeniden deneme ve beşinci denemede vazgeçme.
  - Elle yeniden deneme.
  - Sayfa kapanınca aday alımının durması.
- `apps/web/e2e/lead-ads.e2e.ts`:
  - Sayfada aday alımının açılması.
  - İmzalı bildirimden sonra adayın listede kişi adıyla görünmesi.
