# Özellik anahtarları (modül açma / kapama)

Sahibin kararı (4 Ekim 2026): ürünün her modülü süper admin konsolundan açılıp kapatılabilir; bazı özellikler hazır olduğunda kullanıma açılır. Katalog `packages/shared/src/features.ts` (`FEATURES`), uygulama `apps/api/src/modules/features` içindedir.

## Üç seviye

Bir modülün bir işletme için açık olup olmadığı şu sırayla belirlenir (`isFeatureEnabled`):

1. **İşletmenin kendi ayarı** (`feature_flags`, `scope = RESTAURANT`): varsa her zaman kazanır. Yeni bir modülü yalnızca pilot işletmelere açmak veya bir modülü tek bir işletmede kapatmak için kullanılır.
2. **Genel ayar** (`scope = GLOBAL`): bütün işletmeler için geçerli varsayılan.
3. **Katalog varsayılanı** (`defaultEnabled`): hiçbir ayar yokken. Anahtarlar gelmeden önce çalışan modüller açık, yeni modüller kapalı gelir.

Ayar "boş" (null) yapılınca bir alt seviyeye düşülür; kayıt silinir.

Anahtar, modülün işletme için var olup olmadığına karar verir. Plan (BASIC / PRO, `docs/FIYATLANDIRMA.md`) işletmenin neyi kullanabileceğine, izinler (`docs/PERSONEL.md`) üyenin neyi yapabileceğine karar vermeye devam eder. Üçü birlikte uygulanır: PRO bir modül kapalıysa PRO işletme de kullanamaz.

## Uygulama

- **API, işletme uçları**: denetleyici veya uç `@RequireFeature('<anahtar>')` beyan eder; `PermissionGuard` izin ve plan kontrolünden sonra anahtarı kontrol eder, kapalıysa `403 FEATURE_DISABLED` döner.
- **API anahtarları**: `api_access` kapalıyken işletmenin API anahtarları hiçbir uçta çalışmaz (`FEATURE_DISABLED`); oturumla panel çalışmaya devam eder.
- **Herkese açık uçlar ve servisler**: `FeatureFlagsService.assertEnabled` / `isEnabled` ile. Masa QR sayfası ve siparişi (`table_qr`), değerlendirme (`ratings`), eksik ürün bildirimi (`missing_item_claims`), kısmi iade (`partial_refunds`) kapalıyken `FEATURE_DISABLED` döner; pazaryeri (`marketplace`) kapalı işletmeyi listelemez; kapalı ödeme yöntemi (`online_payment`, `meal_cards`) ödeme seçeneklerinden düşer; `custom_domain` kapalıyken alan adı servis edilmez (kayıt durur); `whatsapp_channel` kapalıyken mesaj SMS olarak gider; `own_courier_dispatch` ve `courier_network` sevk ve kurye ağı uçlarını kapatır; `order_availability` açıkken duraklatılmış veya çalışma saatleri dışındaki işletme müşteri siparişini `RESTAURANT_NOT_ACCEPTING` ile reddeder (`docs/SIPARIS_VE_SEVK.md`, bölüm 6b); `delivery_zones` açıkken yarıçap dışındaki ve alt sınırın altındaki teslimat reddedilir (`docs/VITRIN.md`, "Teslimat bölgesi").
- **Ekranlar**: `GET /auth/me` her üyelikte açık modülleri verir (`MembershipSummaryDTO.features`). Panel menüsü (`visibleNav`) ve mobil sekmeler (`tabsFor`) kapalı modülün ekranını göstermez. Takip sayfası `canRate` / `canClaim` alanlarını anahtara göre verir.
- **Önbellek**: tablo küçüktür; her API süreci tamamını 15 saniye tutar, kendi yazdığında hemen yeniler. Başka bir süreç değişikliği en geç bu sürede görür.

## Konsol

- `/admin/ozellikler`: modüller gruplar halinde (sipariş, ödeme ve iade, teslimat, pazarlama, entegrasyonlar), her birinin açıklaması, aşaması (genel / pilot), genel ayarı (varsayılan / açık / kapalı) ve farklı ayarlanmış işletmeler.
- Restoran sayfası (`/admin/restoranlar/<id>`) "Özellik anahtarları" kartı: her modül için işletmeye özel ayar (genel ayarı izle / açık / kapalı).
- Uçlar (`@SuperAdminOnly()`): `GET /admin/features`, `PUT /admin/features/:key` gövde `{ enabled: true | false | null }`, `GET /admin/restaurants/:id/features`, `PUT /admin/restaurants/:id/features/:key`. Her değişiklik denetim kaydıdır (`feature.global_set`, `feature.restaurant_set`).

## Yeni modül eklemek

1. `FEATURES` kataloğuna anahtar eklenir (`group`, `defaultEnabled: false`, `stage: 'BETA'`); adı ve açıklaması `features.<anahtar>.name` / `.description` i18n anahtarlarıdır.
2. İşletme uçlarına `@RequireFeature`, herkese açık yollara `FeatureFlagsService` kontrolü eklenir; ekranı varsa `PANEL_NAV` öğesine `feature` yazılır.
3. Modül hazır olunca önce pilot işletmelere işletme ayarıyla, sonra genel ayarla açılır; olgunlaşınca `stage: 'GA'` yapılır.

## Mevcut anahtarlar

| Anahtar | Grup | Varsayılan |
| --- | --- | --- |
| `marketplace` | Sipariş | açık |
| `table_qr` | Sipariş | açık |
| `ratings` | Sipariş | açık |
| `missing_item_claims` | Sipariş | açık |
| `claim_escalation` | Sipariş | kapalı (BETA) |
| `app_order_handling` | Sipariş | kapalı (BETA) |
| `order_availability` | Sipariş | kapalı (BETA) |
| `online_payment` | Ödeme | açık |
| `meal_cards` | Ödeme | açık |
| `partial_refunds` | Ödeme | açık |
| `own_courier_dispatch` | Teslimat | açık |
| `courier_network` | Teslimat | açık |
| `delivery_zones` | Teslimat | kapalı (BETA) |
| `crm` | Pazarlama | açık |
| `campaigns` | Pazarlama | açık |
| `loyalty` | Pazarlama | açık |
| `coupons` | Pazarlama | kapalı (BETA) |
| `referrals` | Pazarlama | kapalı (BETA) |
| `partner_referrals` | Pazarlama | kapalı (BETA) |
| `feedback` | Pazarlama | kapalı (BETA) |
| `churn_signals` | Pazarlama | kapalı (BETA) |
| `restaurant_health` | Pazarlama | kapalı (BETA, yalnızca genel anahtar anlamlıdır) |
| `marketing_approvals` | Pazarlama | kapalı (BETA) |
| `audit_viewer` | Entegrasyonlar | kapalı (BETA, yalnızca genel anahtar anlamlıdır) |
| `marketing_platform` | Pazarlama | kapalı (BETA) |
| `contacts_crm` | Pazarlama | kapalı (BETA) |
| `attribution` | Pazarlama | kapalı (BETA) |
| `consent_v2` | Pazarlama | kapalı (BETA) |
| `email_channel` | Pazarlama | kapalı (BETA) |
| `segments_v2` | Pazarlama | kapalı (BETA) |
| `campaigns_v2` | Pazarlama | kapalı (BETA) |
| `journeys` | Pazarlama | kapalı (BETA) |
| `kpi_dashboard` | Pazarlama | kapalı (BETA) |
| `ad_integrations` | Pazarlama | kapalı (BETA) |
| `page_engine` | Pazarlama | kapalı (BETA) |
| `blog` | Pazarlama | kapalı (BETA) |
| `whatsapp_channel` | Pazarlama | açık |
| `custom_domain` | Entegrasyon | açık |
| `api_access` | Entegrasyon | açık |
| `pos_integration` | Entegrasyon | kapalı (BETA) |

Menü, sipariş alma ve işletmenin kendi sipariş sayfası çekirdektir, anahtarı yoktur.
