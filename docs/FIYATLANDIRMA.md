# Fiyatlandırma: planlar ve mesaj kredileri

Karar: bedava dönem süreyle değil katmanla çözülür. "6 ay bedava, sonra ücretli" modeli bitiş günü toplu churn üretir ve hiçbir şey öğretmez. Bunun yerine:

## Katmanlar

| Katman | Fiyat | İçerik |
|---|---|---|
| `BASIC` | Süresiz ücretsiz | Menü yönetimi, sipariş alma, masa QR, yüzde 1 pazaryeri, kendi sipariş sayfası |
| `PRO` | Aylık ücret (platform verisi, `plans` tablosu) | BASIC + CRM, SMS/WhatsApp kampanyaları, gelişmiş analitik, sadakat programı, kuponlar, kendi alan adı, API erişimi |

Yeni restoran `PRO`'yu deneme süresiyle başlar (`PRO_TRIAL_DAYS_DEFAULT = 90`; platform ayarı). Deneme bitince `BASIC`'e düşer: siparişleri almaya devam eder, yalnızca gelişmiş araçlar kapanır. Churn anı yoktur.

Kural kodu `packages/shared/src/plans.ts`: `effectivePlan()` deneme, ödeme gecikmesi ve iptal durumlarını çözer; `PAST_DUE` ve `CANCELLED` ödenmiş dönem bitene kadar PRO kalır. API'de `@RequirePlanFeature('campaigns')` gibi beyanlar `PermissionGuard` tarafından `PLAN_FEATURE_REQUIRED` koduyla reddedilir; UI aynı kodla yükseltme ekranına yönlendirir.

## Mesaj kredileri

SMS ve WhatsApp platforma gerçek para maliyeti olan kanallardır; plandan ayrı ön ödemeli kredi paketleri olarak satılır (`message_credit_packages`). Push ve e-posta ölçülmez.

Kurallar:
- Kredi yalnızca sağlayıcı mesajı kabul ettiğinde (durum `SENT`) düşer. Başarısız gönderim kredi harcamaz.
- Cüzdan asla eksiye düşmez; yetersiz bakiye gönderimi reddeder (`INSUFFICIENT_CREDITS`), `debitCredits()`.
- Yeni restoran küçük bir hoş geldin bakiyesi alır (`WELCOME_MESSAGE_CREDITS_DEFAULT`, kanal başına 25). Gerisi satın alınır.
- OTP ve platform bildirimleri restoranı ücretlendirmez.
- Her hareket `message_transactions` içinde bakiye sonrası değeriyle kayıtlıdır; `message_logs` her denemeyi tutar. Motorun işleyişi ve satın alma akışı: `docs/MESAJLASMA.md`.

## Komisyonun tahsili

`OWN_POS` restoranlarında yüzde 1 komisyon + KDV ay sonunda tek faturada kesilir ve restoranın kayıtlı kartından (aynı kart kasası) veya otomatik ödeme talimatından çekilir. Fatura kesildikten 10 gün sonra ödenmemişse pazaryeri listelemesi askıya alınır; menü, sipariş ekranı ve masa QR çalışmaya devam eder. `PLATFORM_PSP` restoranlarında komisyon hakedişten düşülür, fatura yalnızca belge amaçlıdır. Ayrıntı: `docs/ODEME.md`.

## Fiyatın değişmesi

Plan fiyatları ve paket fiyatları veritabanı verisidir; süper admin değiştirir. Para birimi plan satırındadır; kodda sabit yoktur. Mevcut abonelikler dönem sonuna kadar eski fiyatla devam eder.
