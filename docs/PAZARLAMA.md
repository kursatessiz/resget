# Pazarlama yönetim paketi

Platformun kendi pazarlaması ve restoranların pazarlama modülleri tek bir çekirdek üzerinde çalışır. Kardeş platformdaki (`kursatessiz/deneme`) pazarlama paketi örnek alınmıştır; o depoya dokunulmaz, kalıplar Resget'e uyarlanır. Her modül bir özellik anahtarının arkasındadır (`docs/OZELLIK_ANAHTARLARI.md`) ve kapalı gelir.

## İki kitle

- **B2B, platform pazarlaması**: kişiler restoran sahipleri ve adaylardır. Özel bir kiracı (`Restaurant.isPlatform = true`, slug `platform`) üzerinde, restoranların kullandığı kişiler, kampanyalar, segmentler ve raporlar modülleriyle yürür. Platformun kendi KPI'ları: aday, kayıt, ilk ödeme, ilçe bazında restoran başına günlük sipariş.
- **B2C, restoran pazarlaması**: kişiler restoranın müşterileridir (`RestaurantCustomer`). Kampanyalar, sadakat, kuponlar ve ileride akışlar restoran panelinde çalışır.

## Platform kiracısı ve erişim

- **Kurulum**: süper admin konsoldaki Pazarlama sayfasından (`/admin/pazarlama`) bir kez kurar: ad ve ülke (para birimi, saat dilimi, dil ülke kataloğundan gelir). Kiracı PRO planında süresiz çalışır, pazaryerinde listelenmez, sipariş almaz, komisyonu sıfırdır; restoran listesinde, konsol özetinde ve vitrinde görünmez. En fazla bir platform kiracısı olabilir (veritabanında kısmi tekil indeks). `platform` ve `pazarlama` ayrılmış slug'lardır.
- **Modül anahtarı**: `marketing_platform` (varsayılan kapalı). Kapalıyken `/pazarlama` açılmaz ve platform kiracısının hiçbir ucu çalışmaz (`FEATURE_DISABLED`), üyeleri için de.
- **Platform izinleri** (`packages/shared/src/platform.ts`): `platform.marketing.view`, `platform.marketing.manage`, `platform.marketing.send`, `platform.contacts.export`, `platform.integrations.manage`. Her biri platform kiracısında belirli restoran izinlerine karşılık gelir (`PLATFORM_TENANT_GRANTS`); böylece restoran ekranları ve uçları pazarlama kullanıcısı için değişmeden çalışır.
- **Roller kod içindedir**: pazarlama yöneticisi, editör ve izleyici (`PLATFORM_ROLES`). Her rol platform kiracısında kilitli bir rol şablonu olarak yansıtılır (`systemKey = platform:<rol>`); panelden kimse düzenleyemez veya atayamaz.
- **Kesin sınır**: platform kiracısında roller, personel, işletme ayarları, ödeme, finans, hakediş, fatura ve abonelik izinleri herkes için, süper admin dahil, düşürülür (`PLATFORM_FORBIDDEN_TENANT_PERMISSIONS`, kiracı guard'ı). Pazarlama kullanıcıları yalnızca konsoldan eklenir, rolü değiştirilir ve pasife alınır; personel davetiyle eklenemez.
- **Kullanıcılar**: konsol telefon ve adla ekler; kişi o numarayla telefon koduyla giriş yapar. `/auth/me` restoran üyeliklerini ayrı, platform erişimini ayrı verir (`platform: { role }`); restoranı olmayan pazarlama kullanıcısı girişte doğrudan `/pazarlama`'ya gider.
- **Bağlam**: `GET /platform/context` kişinin platform rolünü, platform izinlerini ve platform kiracısında açık modülleri döner; süper admin her izne sahiptir.

## Pazarlama alanı (`/pazarlama`)

Menü platform izinlerinden ve açık modüllerden kurulur (`MARKETING_NAV`):
- **Özet**: modüllere geçiş ve yol haritası.
- **Kişiler**: platform kiracısının kişileri, restoranın müşteri ekranıyla.
- **Satış hattı** ve **Görevler**: `contacts_crm` modülü açıkken (`docs/CRM.md`).
- **Kampanyalar**: `campaigns` modülü açıkken, restoranın kampanya ekranıyla; gönderim `platform.marketing.send` ister.
- **Atıf**: `attribution` modülü açıkken; aday, restoran kaydı ve ilk ödemenin kaynak, ortam ve kampanya kırılımı (`docs/ATIF.md`).

## Konsol uçları

- `GET /admin/platform`: kiracı, modül durumu ve pazarlama kullanıcıları.
- `POST /admin/platform/setup`: kurulum; tekrar çağrılırsa yalnızca kilitli rolleri yeniden eşitler. PRO planı yoksa `PLANS_MISSING`.
- `POST /admin/platform/users`: kullanıcı ekle (veya rolünü güncelle ve etkinleştir).
- `PATCH /admin/platform/users/:membershipId`: `{ role?, active? }`.

Her işlem denetim kaydına yazılır (`platform.setup`, `platform.user.*`).

## Yol haritası (her madde bir PR, her biri kendi anahtarıyla kapalı gelir)

1. Platform kiracısı, platform rolleri ve Pazarlama alanı (bu belge, tamamlandı).
2. CRM çekirdeği: kişi, satış hattı aşamaları (platform için aday, iletişim, demo, kurulum, canlı, kayıp), görevler, etkinlikler, CSV dışa aktarma (tamamlandı, `docs/CRM.md`; birleştirme ve özel alanlar sonraki adım).
3. Ziyaretçi ve atıf temeli: ziyaretçi ve temas noktası, UTM ve tıklama kimlikleri, rıza bandı (TR KVKK, AB açık rıza, diğerleri bilgi), dönüşüm olayları (aday, restoran kaydı, ilk ödeme, ilk sipariş, tekrar sipariş), masa QR taramasının temas noktasına bağlanması (tamamlandı, `docs/ATIF.md`, anahtar `attribution`; platform sitesinde aday formu dahil).
4. Rıza v2: kanal başına rıza ve hukuki dayanak, AB için çift onay, TR tacir istisnası, sıklık sınırı, gönderim öncesi kontrol. İYS bugün yalnızca SMS, arama ve e-posta kanallarını tutar; WhatsApp izni platformda kanıtıyla saklanır ve İYS'ye gönderilmez (`CONSENT_REGISTRY_COVERAGE`, `docs/KAMPANYALAR.md`). Tamamlandı: `docs/RIZA.md`, anahtar `consent_v2`.
5. E-posta kanalı ve gönderici alan adları (SPF, DKIM, DMARC), geri dönen ve şikayet bastırma (tamamlandı, `docs/EPOSTA.md`, anahtar `email_channel`).
6. Segmentler v2: kural dili (VE / VEYA), dinamik ve statik segment, önizleme (tamamlandı, `docs/SEGMENTLER.md`, anahtar `segments_v2`).
7. Kampanyalar v2: e-posta, A/B, gönderim saati, dönüşüm ve atfedilen gelir (tamamlandı, `docs/KAMPANYALAR.md`, anahtar `campaigns_v2`; açılma ve tıklama ölçümü sonraki adım).
8. Akışlar (otomasyon): sipariş sonrası teşekkür, geri kazanım, doğum günü, değerlendirme isteği, deneme bitişi (B2B). Teşekkür, ilk sipariş, değerlendirme isteği ve geri kazanım tamamlandı (`docs/AKISLAR.md`, anahtar `journeys`); doğum günü (doğum tarihi toplama kararı bekliyor) ve deneme bitişi sonraki adım.
9. Huniler ve platform KPI panosu: masa QR, pazaryeri ve B2B hunisi, ilçe kırılımı (tamamlandı, `docs/HUNILER.md`, anahtar `kpi_dashboard`; pazaryeri ziyaret hunisi ve filtreler sonraki adım).
10. Reklam entegrasyonları ve dönüşüm API'leri (Meta CAPI, Google Ads, TikTok), harcama eşitleme (tamamlandı, `docs/REKLAM.md`, anahtar `ad_integrations`; canlı gönderim platform onaylarını bekler).
11. Sayfa motoru ve SEO: platform sitesi, ilçe ve mutfak açılış sayfaları, site haritası, hreflang, yapılandırılmış veri (tamamlandı, `docs/SAYFA_MOTORU.md` ve `docs/SEO.md`, anahtar `page_engine`; mutfak sayfaları mutfak türü verisi gelince).
12. Blog, IndexNow, `llms.txt` (tamamlandı, `docs/BLOG.md` ve `docs/SEO.md`, anahtar `blog`; IndexNow canlı gönderim `INDEXNOW_KEY` ile).
13. Tavsiye programları: müşteri tavsiyesi ve restorandan restorana tavsiye.
14. Geri bildirim yönlendirme: düşük puan uyarısı, yüksek puanda Google değerlendirme daveti (teşvik yok), NPS.
15. Kayıp riski sinyalleri (müşteri ve restoran).
16. Onaylar, sınırlar ve denetim görüntüleyici (platform gönderimleri).
17. Yapay zeka stüdyosu (yalnızca taslak, kişisel veri modele gitmez, ayrı bütçe).
18. Entegrasyon merkezi, OAuth, Lead Ads, sosyal yayın.

Dış onaylar (Meta App Review, Google geliştirici jetonu, SES üretim erişimi, WhatsApp şablon onayı) 10, 11 ve 18. maddeleri haftalarca bekletebilir; başvurular erken yapılmalıdır.
