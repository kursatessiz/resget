# Platform yönetimi: kayıt, süper admin ve lansman

İki yoldan restoran açılır ve ikisi de aynı hazırlamadan geçer (`RestaurantProvisioningService`): sahibin kendi kaydı (`/kayit`) ve süper adminin konsoldan açması. Platform verisi (komisyon, listeleme, hizmet alanları, planlar, paketler) yalnızca süper adminindir (CLAUDE.md "Süper admin").

## Kendi kendine kayıt (`/kayit`)

1. Ziyaretçi açılış sayfasından `/kayit` adresine gelir. Oturum yoksa `/giris?kayit=1&next=/kayit` ile adını ve telefonunu doğrular; kullanıcı globaldir, bu numara işletmenin sahibi olur.
2. Form: işletme adı, sipariş sayfası adresi (`slug`; boşsa addan `slugify()` ile türetilir ve benzersizleştirilir, seçilen adres doluysa `SLUG_TAKEN`), ülke (`SIGNUP_COUNTRIES`: ülke seçimi para birimini, saat dilimini ve varsayılan dili belirler; liste lansmanlarla büyür), isteğe bağlı unvan ve vergi numarası, ilk şube (adres, il, ilçe, telefon).
3. `POST /restaurants` (JWT) tek işlemde şunları açar: restoran (`isListed: false`, komisyon varsayılanı yüzde 1, `OWN_POS`), şube, varsayılan rol şablonları (`DEFAULT_ROLE_TEMPLATES`), sahip üyeliği (`ACTIVE`), aktif PRO planının deneme süresiyle `TRIALING` abonelik (PRO yoksa `BASIC`), kanal başına hoş geldin mesaj kredisi (`WELCOME_MESSAGE_CREDITS_DEFAULT`), `audit_logs` satırı (`restaurant.created`). İlçe bir hizmet alanıyla eşleşiyorsa (`countryCode` + il + ilçe, büyük küçük harf duyarsız) restoran o alana bağlanır.
4. Sahip `/panel/<slug>` adresine yönlendirilir; menü, masalar ve ayarlar hemen kullanılabilir. Pazaryerinde listelenme süper adminin onayıyla başlar.

## Kendi kendine kayıtta davet

`/kayit?davet=<kod>` bağlantısı başka bir restoranın daveti olarak okunur; giriş sonrasına taşınır, kayıt sayfasında gösterilir ve kayıt gövdesine `partnerCode` olarak eklenir (`docs/RESTORAN_TAVSIYE.md`).

## Süper admin konsolu (`/admin`, `/admin/*` uçları `@SuperAdminOnly()`)

- **Özet**: aktif restoran, listelenen restoran, Pro denemede olanlar, son 7 gün sipariş ve ilçe bazlı yoğunluk tablosu (`GET /admin/overview?days=7|14|30`). Yoğunluk, aktif restoranların şubelerinin il / ilçesine göre gruplanır; `OARD` = pencere içindeki sipariş / restoran / gün (`docs/YOL_HARITASI.md`). Lansman kararı bu tabloya göre verilir.
- **Restoranlar** (`GET /admin/restaurants?query&listed&page&pageSize`, `GET / PATCH /admin/restaurants/:id`): arama (ad, slug, il, ilçe), listeleme talebi ve onayı (`isListed`; restoran menüsünde satışta en az bir ürün ve aktif bir şube varken Ayarlar sayfasından `POST /restaurants/:id/listing-request` ile talep eder, konsol `pending=true` filtresiyle bekleyenleri görür, menü özetine bakar ve not ile onaylar ya da reddeder; karar `listingReviewedAt` ve `listingReviewNote` olarak kalır, sahibe `listing.approved` / `listing.declined` mesajı platform hesabından gider; reddedilen restoran düzeltip yeniden talep eder), aktiflik (`isActive`; pasif restoranın personeli giriş yapamaz ve menüsü açılmaz), komisyon oranı (`commissionBps`, en çok yüzde 20), ödeme modu, PSP yüzdesi ve sabit kesintisi (yalnızca `PLATFORM_PSP`'de kullanılır, `docs/MUTABAKAT.md`), hizmet alanı ataması. `POST /admin/restaurants` sahibin telefonu ve adıyla konsoldan restoran açar (bilinmeyen numara kullanıcı olur). `POST /admin/restaurants/:id/credits` elle kredi yükler (`GRANT`, nota `admin:` öneki).
- **Hizmet alanları** (`GET / POST /admin/service-areas`, `PATCH /admin/service-areas/:id`): ülke, il, ilçe; `isLaunched` lansmanı açar ve ilk açılış tarihini yazar (kapatıp yeniden açmak tarihi değiştirmez). Alan oluşturulduğunda aynı ilçede daha önce kaydolmuş ve alanı olmayan restoranlar otomatik bağlanır. Aynı üçlü ikinci kez eklenemez (`SERVICE_AREA_EXISTS`).
- **Lansman araçları** (`docs/YOL_HARITASI.md`, komşu ilçe): her alan için hazır restoran sayısı (aktif, satışta en az bir ürün ve aktif şube), hedef (`launchTarget`, varsayılan 30, `PATCH` ile değişir), son 30 gün OARD ve pazaryerinde o ilçeyi isteyen ziyaretçi sayısı (`marketplace_interest`, `docs/VITRIN.md`); hazır sayı hedefi bulunca "Lansmana hazır" rozeti. `GET /admin/service-areas/candidates`: hizmet alanı olmadığı halde kayıtlı restoranı veya ziyaretçi talebi olan ilçeler; lansmanlı bir alanın komşusu olanlar önce (`nextToLaunched`, "Lansmanlı ilçeye komşu" rozeti), sonra restoran ve talep toplamına göre sıralı; konsolda "Alan olarak ekle" formu doldurur. Komşuluk verisi alan başına konsoldan girilir (`neighbourDistricts`, aynı ildeki ilçe adları, virgülle; alanın kendisi ve büyük-küçük harf farkıyla tekrarlar atılır, en fazla 30). Lansman kararı yine insanındır; araçlar yalnızca sırayı gösterir.
- **Planlar ve paketler** (`GET / PATCH /admin/plans/:id`, `GET / PUT /admin/credit-packages`): plan adı, aylık ücret, para birimi, deneme süresi, satışta olup olmadığı; kredi paketi koduna göre ekleme veya güncelleme. Fiyatlar veridir, kodda sabit yoktur (`docs/FIYATLANDIRMA.md`).
- **Faturalar** (`/admin/faturalar`, `GET /admin/billing/invoices`, `POST /admin/billing/run`, `POST /admin/billing/invoices/:id/{mark-paid,void,collect}`): tüm komisyon faturaları, günlük işi elle çalıştırma, havaleyle kapatma, iptal, karttan yeniden çekme; restoran kartında askı rozeti (`docs/FATURALAMA.md`).
- **Hakedişler** (`/admin/hakedisler`, `GET /admin/payouts`, `POST /admin/payouts/run`, `POST /admin/payouts/:id/{sent,settled,failed}`): platformun tahsil ettiği restoranların haftalık hakedişleri; haftayı elle kapatma, transfer referansıyla gönderildi, hesaba geçti ve başarısız işaretleri (`docs/MUTABAKAT.md`).
- **Sistem** (`/admin/sistem`, `GET /admin/system`): her açılışta canlı ölçülür; veritabanı gecikmesi ve Redis durumu, sürüm ve çalışma süresi, zamanlanmış işler (günlük fatura işi ve son çalışması `billing.run` denetim satırından, kabul zaman aşımı bekçisi), sağlayıcılar (SMS ve WhatsApp adaptör kodu ve bakiyesi, ödeme, kart kasası, kurye ağı, e-fatura, yol motoru; `MOCK` olanlar sarı rozetle), son 24 saat sayaçları (sipariş, kabul süresi geçen, gönderilen ve başarısız mesaj, açık ve vadesi geçmiş fatura, askıdaki listeleme, aktif restoran) ve restoranlardaki toplam kredi. `ProviderBalanceMonitor` saatte bir bakiyeleri okur; `PROVIDER_BALANCE_WARN` (500) altına düşen kanal için hata günlüğü ve günde bir `provider.balance_low` denetim satırı yazar (`docs/MESAJLASMA.md`).
- Her yazma `audit_logs` tablosuna aktör, eylem, varlık ve değişiklikle kaydedilir.

## Özellik anahtarları (`/admin/ozellikler`)

Her modül genel olarak veya işletme bazında açılıp kapatılır; işletmenin kendi ayarı genel ayarın önüne geçer, yeni modüller kapalı gelir. Ayrıntılar: `docs/OZELLIK_ANAHTARLARI.md`.

## Pazarlama (`/admin/pazarlama`)

Platformun kendi pazarlaması için platform kiracısının bir kez kurulması (ad ve ülke) ve pazarlama kullanıcılarının yönetimi: telefon ve adla ekleme, rol (yönetici, editör, izleyici) ve pasife alma. Modül `marketing_platform` anahtarıyla açılır; açıkken süper admin ve pazarlama kullanıcıları `/pazarlama` alanını görür. Ayrıntı: `docs/PAZARLAMA.md`.

## Restoran tavsiyesi (`/admin/tavsiye`)

Restorandan restorana tavsiye programının açık / kapalı durumu, ödül süreleri, sipariş eşiği ve yıllık sınır; bütün davetler ilerlemesiyle. Ayrıntılar: `docs/RESTORAN_TAVSIYE.md`.

## Yükseltilen bildirimler (`/admin/bildirimler`)

Restoranın 24 saat içinde karara bağlamadığı eksik ürün bildirimleri (`claim_escalation` anahtarı açık restoranlarda). Her kartta restoran, sipariş kodu, bildirilen ürünler, istenen tutar, müşterinin notu ve aynı müşterinin son 90 gündeki tüm bildirimleri görünür. Konsol onaylar (kısmi iade restorana yansır, komisyonun iade payı döner) veya müşteriye gösterilen bir nedenle reddeder. Ayrıntı: `docs/ODEME.md`, "Eksik ürün bildirimi".

## Erişim

- API: `SuperAdminGuard` yalnızca `isSuperAdmin` kullanıcıyı geçirir; `RestaurantTenantGuard` süper admine üyeliksiz tam yetki verir, böylece konsoldan açılan bir restoranın uçları da süper admine açıktır.
- Web: `/admin/*` middleware kapsamındadır (oturum yenileme); `requireSuperAdmin()` süper admin olmayana 404 döner, konsolun varlığını ima etmez. Süper admin bir işletmenin üyesi de olabilir; `/panel` seçicide konsol bağlantısı görünür.
- İlk süper admin geliştirmede seed ile, üretimde bootstrap komutuyla oluşturulur: `node dist/cli/bootstrap.js --super-admin-phone=<E.164> --super-admin-name=<ad>` (`apps/api/src/cli/bootstrap.ts`). Aynı komut `--defaults-only` ile her deploy'da `deploy.sh` içinden çalışır ve yalnızca eksik planları ekler; konsoldan değiştirilen hiçbir şeyi ezmez, hiçbir tabloyu boşaltmaz (`docs/CICD_GUIDE.md` 5b).
