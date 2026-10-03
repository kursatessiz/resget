# Proje Devir Dokümanı (Handover)

Bu dosya, projeyi Claude Code oturumlarıyla kaldığı yerden devam ettirmek için hazırlanmıştır. Önce `CLAUDE.md`, sonra bu dosya okunur.

Depo: https://github.com/kursatessiz/resget

---

## 1. Ürün tanımı

Restoranlar için yüzde 1 komisyonlu sipariş ağı, üstünde ücretsiz temel ve ücretli gelişmiş restoran yazılımı, yanında API ile bağlanan ayrı fiyatlı kurye hizmeti. Masa QR müşteri edinme yüzeyidir. Fikrin fizibilite konuşması ve sayıları `docs/IS_MODELI.md` içinde özetlenmiştir.

## 2. Alınan kesin kararlar (2 Ekim 2026)

- Stack yalnızca TypeScript: Next.js (web), NestJS (API), Prisma, Postgres, Redis. Mobil uygulama Faz 1'de Expo ile eklenir; Faz 0'da tüketici yüzeyi web'dir (QR taraması uygulama kurulumu istemez).
- Komisyon sipariş brüt tutarının yüzde 1'idir (`commissionBps = 100`, restoran başına alan, yalnızca süper admin değiştirir). Platformun satış üzerinden tek geliri budur.
- İki ödeme modu (`docs/ODEME.md`): varsayılan `OWN_POS` (restoranın kendi sanal POS'u tahsil eder, platform ay sonunda komisyon + KDV faturası keser ve kayıtlı karttan çeker; PSP ve tevkifat platformda sıfır) ve `PLATFORM_PSP` (platform tahsil eder, hakedişten düşer; Faz 1). Kart numarası platforma asla girmez; kartlar kasa sağlayıcısında (Masterpass ve bex restoranlar arası, PSP token'ı, cihaz cüzdanları) saklanır, platform yalnızca şifreli token tutar. POS bilgileri AES-256-GCM ile şifrelenir, üretimde KMS zarf şifrelemesi.
- PSP kesintisi (`PLATFORM_PSP`) restorana gerçek oranıyla yansıtılır (`Restaurant.pspPercentBps`, `pspFixedMinor`); platform üzerine marj koymaz. Hacim arttıkça düşen oran restorana da geçer.
- Valör geliri modele dahil değildir. Bekleyen bakiyeden bir fayda doğarsa ödeme kuruluşuyla yazılı anlaşmayla ve ayrı bir gelir kalemi olarak ele alınır; hesaplara şimdiden konmaz.
- E-ticaret tevkifatı (Türkiye yüzde 1, KDV hariç satış bedeli üzerinden) platform geliri değildir; `LedgerEntryType.WITHHOLDING_TAX` ile ayrı tutulur ve bölgesel varsayılan `settlementDefaultsFor()` içindedir.
- Bedava dönem katmanla çözülür, süreyle değil: `BASIC` süresiz ücretsiz, `PRO` deneme süreli (`PRO_TRIAL_DAYS_DEFAULT = 90`). Deneme bitince restoran işletmek için gereken hiçbir şeyi kaybetmez.
- Mesaj kredileri plandan ayrıdır; yalnızca sağlayıcı mesajı kabul edince düşer; hoş geldin kredisi küçüktür (`WELCOME_MESSAGE_CREDITS_DEFAULT`).
- Kurye: platform filo kurmaz. `CourierProviderAdapter` arayüzü ve MOCK adaptör vardır; gerçek ağlar aynı arayüzle eklenir. Ücret `DeliveryFeePolicy` ile müşteriye yansır, komisyondan bağımsızdır.
- Kurye ilan panosu (restoranların kurye araması) hukuki kontrol (İŞKUR özel istihdam bürosu izni) tamamlanmadan geliştirilmez; alternatif olarak mahalle kurye havuzu Faz 2'de değerlendirilir.
- Yemek kartları (3 Ekim 2026, `docs/YEMEK_KARTI.md`): üye işyeri restorandır, platform tek entegrasyon noktasıdır; kart iki şekilde kabul edilir (kapıda: yalnızca işaret; çevrim içi: kuruluş API bilgileri şifreli ve doğrulanmış, adaptör gerekir). Nakit, kapıda kart ve yemek kartı siparişleri `PLATFORM_PSP` restoranında bile `OWN_POS` gibi hesaplanır (`effectivePaymentModeFor`). Ödeme adımı: sipariş niyeti -> hosted oturum (müşteri takip anahtarıyla veya personel) -> imzalı webhook -> `PLACED`; kapıda tahsilat kurye veya kasa tarafından kaydedilir.
- Sipariş ve sevk (3 Ekim 2026, `docs/SIPARIS_VE_SEVK.md`): tek sipariş durum makinesi (`ORDER_TRANSITIONS`, teslimat türüne ve aktöre göre); restoranın kendi kuryesi `courier.deliver` izinli bir üyeliktir ve aynı uygulamayı kullanır; sefer (`DeliveryTrip`) bir veya daha fazla siparişi gruplar, durak sırasını restoran elle belirler ya da rota motoru en kısa rotayı bulur (en yakın komşu + 2-opt, `RoutingProviderAdapter`, bugün HAVERSINE); kurye konumu yalnızca aktif seferde kabul edilir, varış geofence'i durağı kendiliğinden ARRIVING yapar; tüm değişiklikler SSE ile sevk panosuna, kuryeye ve müşterinin takip sayfasına (`/t/<token>`) yayınlanır; müşteri yalnızca kendi siparişini, kuryenin yalnızca adını ve sefer sürerken konumunu görür.
- Coğrafi yoğunluk: `ServiceArea` (ilçe) ve `isLaunched` bayrağı. Lansmanı yapılmamış ilçedeki restoran panelini kullanır ama pazaryerinde listelenmez.
- Kullanıcı kimliği global ve telefon bazlıdır; personel ve müşteri aynı `User` tablosundadır; restorana bağ `Membership`.
- Yetkilendirme izin tabanlıdır; `@RestaurantScoped()` + `@RequirePermission()`; izin beyan etmeyen handler reddedilir; `PRO` özellikleri `@RequirePlanFeature()`.
- Tasarım dili Perfect UI; token'lar ve i18n çekirdeği kardeş platformdan (`kursatessiz/deneme`) kopyalanmıştır; o depo salt okunur referanstır.

## 3. Mevcut kod durumu (2 Ekim 2026, ilk kurulum)

- `packages/shared`: enum'lar, izin kataloğu ve varsayılan roller, `Money` yardımcıları, `computeOrderSettlement()` (kimlik denklemi testli), plan kuralları (`effectivePlan`, `hasFeature`, kredi düşümü), kurye arayüzü ve teslimat ücreti politikası, masa QR token ve huni hesabı, Perfect UI token'ları, i18n çekirdeği ve 12 mesaj ad alanı (tr + en).
- `packages/database`: 30 tablolu Prisma şeması, `20261002000000_init` migration'ı, geliştirme seed'i (demo restoran, menü, 4 masa, PRO deneme, hoş geldin kredileri, MOCK kurye ağı, Kadıköy hizmet alanı).
- `apps/api`: env doğrulama, hata kodu filtresi, health, Prisma ve Redis, MOCK SMS sağlayıcısı, telefon OTP ile giriş ve JWT (access 15 dk, refresh 30 gün), `GET /auth/me`, guard'lar ve dekoratörler (testli), `GET /restaurants/:id`, menü (`GET /public/qr/:token` huni olayı kaydeder), moda duyarlı hakediş önizleme (`POST /restaurants/:id/orders/settlement-preview`), kurye teklifi (`POST /restaurants/:id/courier/quote`, MOCK), masalar (liste, oluştur, QR yenile, huni raporu), ödemeler (`/restaurants/:id/payments/*`: ayarlar, şifreli POS bağlantısı ve doğrulama, mod değişimi, aylık komisyon dökümü; `/me/payment-methods/*`: kasa ile kart bağlama, listeleme, silme; MOCK gateway ve MOCK kasa; `CredentialCipher`).
- Yemek kartları ve ödeme adımı (`docs/YEMEK_KARTI.md`): `MealCardsService` (katalog, kabul listesi, şifreli kuruluş bilgileri; `/restaurants/:id/payments/meal-cards`), `CheckoutService` (niyet çözümleme, hosted oturum: `POST .../orders/:orderId/checkout` ve `POST /public/orders/:token/checkout`, imzalı webhook `POST /webhooks/payments/{meal-cards|pos}/:connectionId`, kapıda tahsilat `POST .../orders/:orderId/collect` ve kurye `.../stops/:stopId/collect`), `GET /public/restaurants/:slug/payment-methods`, menü sayfasında kabul edilen kartlar; MOCK kuruluş adaptörü. e2e: `meal-cards.e2e-spec.ts` (7 senaryo).
- Sipariş ve sevk (`docs/SIPARIS_VE_SEVK.md`): `OrdersService` (personel siparişi oluşturma, hakediş ve ürün anlık görüntüleri, müşteri kaydı, takip anahtarı, durum geçişi ve geçmişi, liste / detay, iletişim maskeleme), `/restaurants/:id/orders/*`; `DispatchService` ve `/restaurants/:id/dispatch/*` (pano, sefer oluşturma, kurye atama, durak ekleme / çıkarma, elle sıralama, en kısa rota, teslim alma, yola çıkma, teslim, teslim edilemedi, iptal); `/restaurants/:id/courier/me/*` (kuryenin seferleri, adımlar, konum partileri); `LocationService` (son konum, seyreltilmiş iz, ETA yenileme, geofence, yayın sınırı); `RealtimeService` (SSE, Redis fan-out, tekrar tamponu, kalp atışı); `GET /public/orders/:token` ve `/events`. e2e: `dispatch.e2e-spec.ts` (12 senaryo, uçtan uca akış ve SSE).
- `apps/web` oturum ve kabuk (A2): `/giris` (telefon + kod, misafir kaydı için ad), `POST /api/session/verify` ve `/logout` route handler'ları (httpOnly çerezler), `middleware.ts` (erişim jetonu yenileme, `/giris` yönlendirmesi, masa QR oturum çerezi), `/panel` işletme seçici, `/panel/[slug]` kabuğu (`PanelShell`: izinlerden menü, işletme rengi, değiştirici, çıkış), özet sayfası; `TextField` bileşeni; Playwright `auth.e2e.ts`.
- `apps/web`: Perfect UI ile açılış sayfası, `/m/<token>` herkese açık menü sayfası (sunucuda API'den çekilir, restoran renginde), `/t/<token>` canlı sipariş takip sayfası (sunucu anlık görüntüsü + SSE ile `TrackingLive`), BFF proxy (gövdeyi akış olarak aktarır), giriş ve panel kabuğu, `/panel/<slug>/siparisler` sipariş ekranı ve `/panel/<slug>/sevk` sevk panosu (SSE ile canlı, `useRealtime`), `ThemeRoot`, `Button`, `Card`, `Field`, `Select`, `Badge`.
- `deploy`: dev ve prod compose, Caddyfile, API ve web Dockerfile'ları.
- Testler: shared ve API birim testleri; API e2e (`apps/api/test/e2e`: health, auth, kiracı izolasyonu, herkese açık menü, hakediş önizleme, masalar ve huni, kurye teklifi); web e2e (`apps/web/e2e`: açılış, masa QR menüsü, dil seçimi, giriş ve panel kabuğu, sipariş takibi, sipariş ekranı ve sevk panosu).
- CI/CD ve güvenlik (kardeş platformla aynı yöntem, `docs/CICD_GUIDE.md`): `ci.yml` (build, typecheck, test, prettier, audit, migration ve drift, API e2e, web e2e, shellcheck, actionlint, imaj derleme), `release.yml` (imajlar GHCR'ye, preprod/production ortamları, SSH deploy, rollback), `codeql.yml`, `security.yml` (dependency review, TruffleHog, zizmor), `scorecard.yml`, `lighthouse.yml`, dört Claude ajan workflow'u (`CLAUDE_AGENTS_ENABLED` açılana kadar pasif), Dependabot; `deploy/scripts` (server-init, deploy, healthcheck, rollback, nightly, backup).

Henüz yok: müşteri tarafı sipariş verme ekranı (sepet, adres; ödeme adımı API'de hazır), gerçek yemek kartı kuruluşu adaptörleri, ödeme sağlayıcı adaptörleri (pazaryeri / alt üye işyeri ürünü), hakediş (payout) zamanlayıcısı, restoran panelinin menü, masa, ayar ve ödeme ekranları, davet akışı, kampanya ve CRM, süper admin paneli ve platform verisi bootstrap komutu, mobil uygulama (kurye modu dahil), herkese açık uçlarda oran sınırı, gerçek yol motoru adaptörü.

## 4. Backlog

Her öğe bir PR'dır. Sıra, Faz 0'ın tek ilçede 30 ila 50 restoranla çalışmasını hedefler.

### A. Faz 0 çekirdeği
- A1. Sipariş çekirdeği: tamamlandı (sipariş oluşturma, anlık görüntüler, durum makinesi ve geçmiş, takip anahtarı, kendi kurye sevki, canlı takip; `docs/SIPARIS_VE_SEVK.md`). Kalan: müşteri tarafı sepet ve ödeme adımı (A4 / A9 ile), herkese açık uçlarda Redis oran sınırı, kabul zaman aşımı.
- A2. Giriş ve oturum: tamamlandı (giriş ekranı, httpOnly çerezler ve middleware yenileme, işletme seçici ve panel kabuğu, masa QR'dan misafir kaydı ve `REGISTERED` huni olayı). Kalan: restoran kendi kendine kayıt (`/kayit`, bugün açılış sayfasındaki bağlantı boş), A8 ile birlikte.
- A3. Restoran paneli: sipariş ekranı ve sevk panosu tamamlandı (`/panel/<slug>/siparisler`: yeni / mutfak / hazır / kapanan bölümleri, SSE ile canlı liste, kabul ve hazırlık süresi, ret ve iptal nedeni, durum geçişleri; `/panel/<slug>/sevk`: hazır siparişlerden sefer oluşturma, durak sıralama ve en kısa rota, kurye atama, teslim alma ve yola çıkış, teslim ve başarısız teslim, iptal; `OrdersBoard`, `DispatchBoard`, `useRealtime`). Kalan: harita görünümü, menü yönetimi, masalar ve QR etiket indirme (PNG/PDF), ayarlar (logo, renk, teslimat modu, teslimat ücreti politikası, sevk ayarları), ödeme ve yemek kartı bağlantı ekranları.
- A4. Ödeme (`OWN_POS`): iyzico, PayTR, Param ve Sipay gateway adaptörleri (hosted sayfa + imzalı webhook), Masterpass kasa adaptörü, gerçek yemek kartı kuruluşu adaptörleri (sözleşme sırasına göre), kayıtlı kartla ödeme, `LedgerEntry` yazımı, iade. Ödeme adımının çekirdeği (niyet, hosted oturum, webhook, kapıda tahsilat) tamamlandı (`docs/YEMEK_KARTI.md`).
- A5. Komisyon faturası: aylık `CommissionInvoice` kesimi, kayıtlı karttan otomatik tahsilat, gecikme ve pazaryeri askıya alma, restoran fatura ekranı, e-Arşiv entegrasyonu.
- A6. Personel daveti: `InviteToken`, QR veya SMS ile davet, rol şablonu düzenleme.
- A7. Bildirimler: sipariş bildirimleri (push/web, SMS yedek), mesaj kredisi düşümü yalnızca SENT'te, kredi paketi satın alma.
- A8. Süper admin: restoran listesi ve listeleme onayı, komisyon ve PSP oranı, hizmet alanı lansmanı, plan ve paket yönetimi, ilçe bazlı OARD panosu.
- A9. Pazaryeri tüketici web'i: ilçe içi restoran listesi, restoran sayfası (`/<slug>`), adres ve teslimat seçimi, sipariş takibi.
- A10. Platform verisi bootstrap komutu (`--defaults-only`: planlar, kredi paketleri, kurye ağları; ilk süper admin) ve `deploy.sh` içine bağlanması; sunucu ilk kurulumunun preprod'da denenmesi.

### B. Faz 1 (genişleme eşiği: restoran başına günlük sipariş 2'yi geçince)
- B1. Expo uygulaması (tek uygulama, rol üyelikten gelir): müşteri (takip, tekrar sipariş, QR'dan derin bağlantı), kurye modu (sefer listesi ve adımları, arka plan konum partileri, harita), restoran tablet sevk panosu. API sözleşmesi hazır (`docs/SIPARIS_VE_SEVK.md` bölüm 7).
- B2. PRO katmanı: CRM listesi, segmentler, SMS/WhatsApp kampanyaları, sadakat, gelişmiş analitik, kendi alan adı.
- B3. Komşu ilçe lansmanı araçları ve pazaryeri sıralaması.
- B4. `PLATFORM_PSP` modu: PSP pazaryeri ürünü, PSP token kasası, hakediş ödemeleri (yasal sürede), tevkifat beyanı; yemek kartı ve ek ödeme yöntemleri.

### C. Faz 2 (kurye)
- C1. Gerçek kurye ağı adaptörü (ülkeye göre), webhook imza doğrulaması, `DeliveryRequest` yaşam döngüsü, sipariş ekranında kurye çağırma.
- C2. Mahalle kurye havuzu değerlendirmesi (hukuki görüş sonrası).

## 4a. Çalışma yöntemi

Kardeş platformda oturmuş hat aynen uygulanır: her backlog öğesi izole bir worktree'de çalışan ve maliyet kademesine göre seçilen (Haiku/Sonnet/Opus) bir ajana verilir; koordinatör dalı `main` üzerine birleştirir, tam yerel doğrulamayı (install, build/typecheck/test, taze DB migrate + drift + seed, API e2e, web e2e, audit, prettier, shellcheck/actionlint) geçirir, Türkçe PR açar, tüm CI kontrolleri yeşilken merge eder. Backlog öğesi başına bir PR. Sahibin yapması gereken GitHub ayarları: `docs/CICD_GUIDE.md` bölüm 6 ve 7 (ruleset, secret scanning, Environments, `CLAUDE_AGENTS_ENABLED`).

## 5. Açık sorular (sahibin kararı)

- Pilot ilçe hangisi olacak? Seed Kadıköy'ü örnek alır.
- PRO fiyatı ve deneme süresi: seed'de 1.499 TL/ay ve 90 gün örnek değerdir.
- İlk gateway adaptörleri hangi sırayla? Pilot ilçedeki restoranların mevcut POS sağlayıcılarına göre seçilir. Platform PSP'si için pazaryeri ürünü koşulları (BSMV dahil kesinti, iade komisyonu, transfer sıklığı, bloke) Faz 1 öncesinde netleşir.
- Masterpass ve bex (BKM) üye işyeri sözleşmeleri; hangisinin önce bağlanacağı pilot ilçedeki POS sağlayıcılarına göre. `OWN_POS` modunda tevkifat yükümlülüğü için vergi danışmanı teyidi.
- Komisyon faturasında alt limit: küçük tutarlar bir sonraki aya devredilsin mi, eşik ne olsun?
- Kapıda ödeme Faz 0'da açık mı? Açıksa PSP kesintisi olmaz ama tahsilat riski restorandadır; hakediş motoru bu durumda `psp.percentBps = 0` ile çalışır.
- Yemek kartları: ilk gerçek adaptörler hangi kuruluşlarla (pilot ilçe kabul oranına göre); her kuruluşun çevrim içi ödeme API dokümanı ve restoran adına test üye işyeri hesabı gerekir. Kapıda nakit ve kart kabulü Faz 0'da her restoranda açık; restoran bazlı anahtar A3 ile.
- Harita ve yol motoru sağlayıcısı (kurye uygulaması ve sevk panosu haritası, gerçek yol ETA'sı): Google Maps, Mapbox veya OSRM; ücret ve lisans kararı sahibindir. Koda yalnızca `RoutingProviderAdapter` ile girer.
- Teslimat ücreti KDV oranı: `deliveryFeeVatBpsFor('TR')` bugün yüzde 20 varsayar; vergi danışmanı teyidi gerekir.
