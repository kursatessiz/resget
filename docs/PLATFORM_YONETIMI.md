# Platform yönetimi: kayıt, süper admin ve lansman

İki yoldan restoran açılır ve ikisi de aynı hazırlamadan geçer (`RestaurantProvisioningService`): sahibin kendi kaydı (`/kayit`) ve süper adminin konsoldan açması. Platform verisi (komisyon, listeleme, hizmet alanları, planlar, paketler) yalnızca süper adminindir (CLAUDE.md "Süper admin").

## Kendi kendine kayıt (`/kayit`)

1. Ziyaretçi açılış sayfasından `/kayit` adresine gelir. Oturum yoksa `/giris?kayit=1&next=/kayit` ile adını ve telefonunu doğrular; kullanıcı globaldir, bu numara işletmenin sahibi olur.
2. Form: işletme adı, sipariş sayfası adresi (`slug`; boşsa addan `slugify()` ile türetilir ve benzersizleştirilir, seçilen adres doluysa `SLUG_TAKEN`), ülke (`SIGNUP_COUNTRIES`: ülke seçimi para birimini, saat dilimini ve varsayılan dili belirler; liste lansmanlarla büyür), isteğe bağlı unvan ve vergi numarası, ilk şube (adres, il, ilçe, telefon).
3. `POST /restaurants` (JWT) tek işlemde şunları açar: restoran (`isListed: false`, komisyon varsayılanı yüzde 1, `OWN_POS`), şube, varsayılan rol şablonları (`DEFAULT_ROLE_TEMPLATES`), sahip üyeliği (`ACTIVE`), aktif PRO planının deneme süresiyle `TRIALING` abonelik (PRO yoksa `BASIC`), kanal başına hoş geldin mesaj kredisi (`WELCOME_MESSAGE_CREDITS_DEFAULT`), `audit_logs` satırı (`restaurant.created`). İlçe bir hizmet alanıyla eşleşiyorsa (`countryCode` + il + ilçe, büyük küçük harf duyarsız) restoran o alana bağlanır.
4. Sahip `/panel/<slug>` adresine yönlendirilir; menü, masalar ve ayarlar hemen kullanılabilir. Pazaryerinde listelenme süper adminin onayıyla başlar.

## Süper admin konsolu (`/admin`, `/admin/*` uçları `@SuperAdminOnly()`)

- **Özet**: aktif restoran, listelenen restoran, Pro denemede olanlar, son 7 gün sipariş ve ilçe bazlı yoğunluk tablosu (`GET /admin/overview?days=7|14|30`). Yoğunluk, aktif restoranların şubelerinin il / ilçesine göre gruplanır; `OARD` = pencere içindeki sipariş / restoran / gün (`docs/YOL_HARITASI.md`). Lansman kararı bu tabloya göre verilir.
- **Restoranlar** (`GET /admin/restaurants?query&listed&page&pageSize`, `GET / PATCH /admin/restaurants/:id`): arama (ad, slug, il, ilçe), listeleme onayı (`isListed`), aktiflik (`isActive`; pasif restoranın personeli giriş yapamaz ve menüsü açılmaz), komisyon oranı (`commissionBps`, en çok yüzde 20), ödeme modu, PSP yüzdesi ve sabit kesintisi (yalnızca `PLATFORM_PSP`'de kullanılır, `docs/MUTABAKAT.md`), hizmet alanı ataması. `POST /admin/restaurants` sahibin telefonu ve adıyla konsoldan restoran açar (bilinmeyen numara kullanıcı olur). `POST /admin/restaurants/:id/credits` elle kredi yükler (`GRANT`, nota `admin:` öneki).
- **Hizmet alanları** (`GET / POST /admin/service-areas`, `PATCH /admin/service-areas/:id`): ülke, il, ilçe; `isLaunched` lansmanı açar ve ilk açılış tarihini yazar. Alan oluşturulduğunda aynı ilçede daha önce kaydolmuş ve alanı olmayan restoranlar otomatik bağlanır. Aynı üçlü ikinci kez eklenemez (`SERVICE_AREA_EXISTS`).
- **Planlar ve paketler** (`GET / PATCH /admin/plans/:id`, `GET / PUT /admin/credit-packages`): plan adı, aylık ücret, para birimi, deneme süresi, satışta olup olmadığı; kredi paketi koduna göre ekleme veya güncelleme. Fiyatlar veridir, kodda sabit yoktur (`docs/FIYATLANDIRMA.md`).
- **Faturalar** (`/admin/faturalar`, `GET /admin/billing/invoices`, `POST /admin/billing/run`, `POST /admin/billing/invoices/:id/{mark-paid,void,collect}`): tüm komisyon faturaları, günlük işi elle çalıştırma, havaleyle kapatma, iptal, karttan yeniden çekme; restoran kartında askı rozeti (`docs/FATURALAMA.md`).
- Her yazma `audit_logs` tablosuna aktör, eylem, varlık ve değişiklikle kaydedilir.

## Erişim

- API: `SuperAdminGuard` yalnızca `isSuperAdmin` kullanıcıyı geçirir; `RestaurantTenantGuard` süper admine üyeliksiz tam yetki verir, böylece konsoldan açılan bir restoranın uçları da süper admine açıktır.
- Web: `/admin/*` middleware kapsamındadır (oturum yenileme); `requireSuperAdmin()` süper admin olmayana 404 döner, konsolun varlığını ima etmez. Süper admin bir işletmenin üyesi de olabilir; `/panel` seçicide konsol bağlantısı görünür.
- İlk süper admin geliştirmede seed ile, üretimde bootstrap komutuyla oluşturulur: `node dist/cli/bootstrap.js --super-admin-phone=<E.164> --super-admin-name=<ad>` (`apps/api/src/cli/bootstrap.ts`). Aynı komut `--defaults-only` ile her deploy'da `deploy.sh` içinden çalışır ve yalnızca eksik planları ekler; konsoldan değiştirilen hiçbir şeyi ezmez, hiçbir tabloyu boşaltmaz (`docs/CICD_GUIDE.md` 5b).
