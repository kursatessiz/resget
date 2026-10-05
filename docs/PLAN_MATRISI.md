# Plan matrisi: planlar veri, özellikler plana dağıtılır

Karar (sahip): planlar koddan çıkar ve veri olur. Yeni plan eklemek kod değişikliği gerektirmez. Hangi özelliğin hangi planda olacağını süper admin konsoldan seçer. Plandan çıkarılan özellik dönem sonuna kadar korunur. Süper admin tek bir restorana "plan dışı açık" verebilir.

## Kavramlar

- **Plan** (`plans` tablosu): kod, ad, aylık fiyat, para birimi, deneme süresi, satışta mı ve dışarıda bıraktığı anahtarlar (`excludedFeatures`). İki kod yerleşiktir: `BASIC` her restoranın düştüğü ücretsiz taban plandır (`FALLBACK_PLAN_CODE`), `PRO` yeni restoranların denediği plandır (`TRIAL_PLAN_CODE`). Diğer her plan konsoldan eklenir.
- **Yetki anahtarı** (`EntitlementKey`, `packages/shared/src/entitlements.ts`): plan özellikleri (`PLAN_FEATURES`: crm, campaigns, analytics, loyalty, coupons, custom_domain, api_access ...) ile özellik anahtarı kataloğundaki her modül (`features.ts`). Aynı adı taşıyan anahtarlar (örneğin `crm`, `campaigns`) iki tarafta aynı şeydir.
- **Çekirdek** (`CORE_ENTITLEMENTS`): menü, sipariş alma, masa QR, pazaryeri, kendi sipariş sayfası. Her planda vardır, matris bunları göstermez. BASIC işletmek için gereken hiçbir şeyi kaybetmez.

## Neden dışlama listesi

Plan satırı taşıdığı anahtarları değil, dışarıda bıraktıklarını saklar. Kataloğa yeni bir modül eklendiğinde (her yeni modül kapalı gelir) bu modül otomatik olarak her plandadır ve yalnızca özellik anahtarı karar verir; her modül PR'ında planlara migration yazmak gerekmez. Konsol ve API her zaman pozitif listeyi gösterir (`planFeaturesFrom()`, `exclusionsFrom()`).

## Bir restoran neyi kullanabilir

1. Geçerli plan: abonelik çalışıyorsa (aktif, süren deneme, ödenmiş dönemi bitmemiş gecikme veya iptal) aboneliğin planı, değilse taban plan (`effectivePlan()`).
2. Bu planın listesi + çekirdek.
3. Restoranın süren izinleri (`restaurant_entitlements`):
   - `GRACE`: anahtar plandan çıkarıldığında yazılır, dönem sonuna kadar sürer.
   - `EXCEPTION`: süper adminin "plan dışı açık" izni; süresiz veya bir tarihe kadar.

Sonuç `resolveEntitlements()` ile hesaplanır. API'de `EntitlementsService` bunu yapar: plan satırları süreç içinde 15 saniye önbelleklenir (konsoldaki değişiklik aynı süreçte hemen yenilenir), abonelik ve izinler her çağrıda okunur; yükseltme veya yeni istisna anında geçerlidir.

## Kontroller

- **Plan özellikleri** önceki davranışını korur: `@RequirePlanFeature('<anahtar>')` beyanı `PermissionGuard` içinde restoranın yetki kümesine bakar ve yoksa `403 PLAN_FEATURE_REQUIRED` döner. Bu özelliklerin okuma uçları (liste, yükseltme ekranı) planda olmasa da açık kalır; servislerdeki kontroller (kupon kabulü, sadakat, kendi alan adı, geri bildirim) da aynı kümeye bakar.
- **Düz modüller** (plan özelliği olmayan her katalog anahtarı) hem anahtarın açık olmasını hem planın taşımasını ister. `FeatureFlagsService.isEnabled/assertEnabled` ikisini birlikte kontrol eder; anahtar kapalıysa `FEATURE_DISABLED`, açık ama plan taşımıyorsa `PLAN_FEATURE_REQUIRED` döner. Herkese açık yüzeyler de aynı servisi kullandığı için plan dışı modül vitrinde de görünmez.
- **Panel ve mobil**: `/auth/me` üyeliği `effectivePlan`, `planName`, `entitlements` ve `features` taşır. `features` plan dışı düz modülleri içermez, menü ve sekmeler bunlardan kurulur. Ekranlar "Pro mu" diye değil, ilgili anahtar `entitlements` içinde mi diye bakar (`kampanyalar` -> `campaigns`, `raporlar` -> `analytics` gibi).

## Plandan özellik çıkarmak: dönem sonuna kadar koruma

Süper admin bir planın listesinden bir anahtarı çıkardığında, o anda geçerli planı bu olan her restorana anahtar başına bir `GRACE` satırı yazılır:

| Restoranın durumu | Koruma bitişi |
|---|---|
| Ücretli planda, aktif veya gecikmede / iptalde dönemi sürüyor | `currentPeriodEnd` |
| Denemede | `trialEndsAt` |
| Ücretsiz taban planda (abonelik yok veya süresi geçmiş) | İçinde bulunulan UTC ayının sonu |
| Abonelik dönem sonu bilmiyorsa | İçinde bulunulan UTC ayının sonu |

Restoranın zaten daha uzun süren bir koruması varsa o korunur. Anahtar plana geri eklenirse koruma satırları zararsız biçimde kendi süresinde biter. Süper admin bir korumayı restoran detayından erken sonlandırabilir.

## Plan dışı açık

Restoran detayındaki "Plan ve plan dışı izinler" kartı: geçerli planı, süren korumaları ve istisnaları gösterir; planın taşımadığı bir anahtarı süresiz veya bir tarihe kadar açar ve not alır. Aynı anahtara ikinci istisna öncekinin yerine geçer. İstisna bir plan özelliğini de açabilir (örneğin tek bir restorana kampanyalar).

## Plan atama

Self servis ödeme akışı gelene kadar restoran detayındaki "Plan ata" bir restoranı herhangi bir plana geçirir: abonelik `ACTIVE` olur, isteğe bağlı ödenmiş dönem sonu yazılır (geçmiş tarih reddedilir), deneme bitişi silinir. Atama hemen geçerlidir ve koruma yazmaz; bu süper adminin kendi kararıdır (`subscription.assigned` denetim kaydı).

## Konsol

`/admin/planlar`:
- Plan kartları: ad, fiyat, para birimi, deneme süresi, satışta. Taban plan satıştan kaldırılamaz ve ücretli yapılamaz (`PLAN_FALLBACK_LOCKED`).
- Yeni plan: kod (büyük harf, rakam, alt çizgi; sonradan değişmez), ad, fiyat, para birimi, deneme süresi. Başlangıç listesi taban planınkidir; matris değiştirir. Aynı kod ikinci kez kullanılamaz (`PLAN_CODE_TAKEN`). Yerleşik olmayan planlar panelde kendi adıyla görünür.
- Matris: satırlar gruplu anahtarlar, sütunlar planlar. Kaydet her değişen planın listesini gönderir ve plan başına eklenen, çıkarılan ve korumaya alınan restoran sayısını gösterir.

Her değişiklik denetim kaydına yazılır: `plan.created`, `plan.updated`, `subscription.assigned`, `plan.features_updated` (eklenen, çıkarılan, koruma sayısı), `entitlement.exception_granted`, `entitlement.revoked`.

## API

Hepsi süper admin:
- `GET /admin/plans`, `POST /admin/plans`, `PATCH /admin/plans/:id`
- `PUT /admin/plans/:id/features` (`{ features: EntitlementKey[] }`) -> `{ added, removed, graceGranted }`
- `GET /admin/restaurants/:id/entitlements`
- `PUT /admin/restaurants/:id/plan` (`{ planId, currentPeriodEnd? }`)
- `POST /admin/restaurants/:id/entitlements` (`{ key, until?, note? }`)
- `DELETE /admin/restaurants/:id/entitlements/:grantId`

## Geçiş

Migration `20261127000000_plan_entitlements` bugünkü davranışı aynen korur: `BASIC` önceki PRO özelliklerini dışarıda bırakır, `PRO` hiçbir şeyi dışarıda bırakmaz, her modül iki planda da vardır. Seed ve `bootstrap` komutu yerleşik planları aynı listelerle oluşturur (`DEFAULT_PLAN_EXCLUSIONS`).

## Testler

`packages/shared/src/entitlements.spec.ts` (çözüm, dışlama, koruma bitişi), `apps/api/test/e2e/plan-matrix.e2e-spec.ts` (koruma, istisna, yeni plan, taban plan kilidi), Playwright `admin-plan-matrix.e2e.ts`.
