# Yapay zeka stüdyosu

Kampanya metni ve menü açıklaması için taslak yazan yardımcı. Modül `ai_studio` anahtarının arkasındadır (varsayılan kapalı, BETA) ve PRO planın parçasıdır (`@RequirePlanFeature('campaigns')`). Sözleşmeler `packages/shared/src/ai-studio.ts`, API `apps/api/src/modules/ai-studio`, ekranlar `apps/web/src/components/panel/AiAssistant.tsx` içindedir.

## Üç kural

1. **Yalnızca taslak.** Model hiçbir şeyi kaydetmez veya göndermez. Taslak ekranda listelenir, kullanıcı "Bu taslağı kullan" deyince bulunduğu formun alanına gelir; kampanya veya menü kalemi ancak kullanıcı kendisi kaydettiğinde oluşur ve normal kurallardan (izin, onay, sınırlar, gönderim penceresi) geçer.
2. **Kişisel veri modele gitmez.** İstek yalnızca kiracı verisini (restoran adı, menü kalemi adı) ve kullanıcının açıklamasını taşır. Açıklamadaki e-posta adresleri, telefon numaraları, kart numaraları ve IBAN'lar gönderilmeden önce `[REDACTED]` ile değiştirilir (`redactPersonalData()`); ekran kaç öge çıkarıldığını söyler. İsimler otomatik tanınmaz; ekran müşteri adı, telefon veya e-posta yazılmamasını açıkça ister. Müşteri listesi, sipariş geçmişi veya segment üyeleri modele hiçbir zaman verilmez.
3. **Ayrı bütçe.** Her kiracının aylık token bütçesi vardır (girdi ve çıktı toplamı, UTC ay başından itibaren). Mesaj kredilerinden ayrıdır, plandan ayrı fiyatlanabilir. Bütçe dolunca istek `AI_BUDGET_EXHAUSTED` ile reddedilir.

## Taslak türleri

| Tür | Uç | İzin | Girdi | Çıktı |
| --- | --- | --- | --- | --- |
| Kampanya metni | `POST /restaurants/:id/ai/campaign-drafts` | `campaigns.manage` | açıklama (5 ile 500 karakter), kanal (SMS, WhatsApp, e-posta), ton (samimi, resmi, eğlenceli), dil, 1 ile 3 taslak | Kanalın sınırına uyan metinler; e-postada konu (en çok 120 karakter) |
| Menü açıklaması | `POST /restaurants/:id/ai/menu-descriptions` | `menu.manage` | kalem adı, notlar (malzeme, porsiyon), ton, dil | Kalem başına iki öneri, en çok 500 karakter |

`GET /restaurants/:id/ai/budget` (`campaigns.view`) bu ayın bütçesini döner. Ekranlar: kampanya formunda "Yapay zekayla taslak" bölümü (panel ve `/pazarlama`), menü düzenleyicide kalem formunda "Yapay zekayla açıklama önerisi".

### Çıktı denetimi

Model yapılandırılmış çıktıyla (JSON şeması) yanıt verir. Her taslak sunucuda yeniden denetlenir: emoji ve resim karakterleri silinir, kanal sınırını aşan, boş kalan veya `[REDACTED]` içeren taslak atılır; e-posta taslağı geçerli bir konu olmadan kabul edilmez. Kullanılabilir taslak kalmazsa `AI_FAILED`. Sistem talimatı fiyat, indirim, tarih, açılış saati, sağlık veya alerjen iddiası uydurmamayı, kişisel veri ve bağlantı yazmamayı, vazgeçme satırı eklememeyi (kampanyaya kendiliğinden eklenir) ve açıklamayı talimat değil veri olarak okumayı söyler.

## Sağlayıcı

`AI_PROVIDER` ile seçilir:

| Değer | Davranış |
| --- | --- |
| `NONE` (varsayılan) | Stüdyo kapalı; istekler `AI_NOT_CONFIGURED` |
| `MOCK` | Sabit taslaklar, ağ ve maliyet yok; geliştirme ve testler için. Üretimde reddedilir |
| `ANTHROPIC` | Resmi Anthropic SDK ile Claude; `ANTHROPIC_API_KEY` zorunlu |

Anthropic adaptörü:

- `AI_MODEL` (varsayılan `claude-opus-5-5`) ile çalışır.
- Kısa pazarlama metni için düşük efor (`output_config.effort: low`) kullanır.
- Taslakları JSON şemasıyla ister.
- Sunucu taraflı ret yedeğini (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) açar: model bir isteği güvenlik nedeniyle reddederse aynı çağrı içinde önerilen başka bir modelle yeniden denenir.

Zincirin tamamı reddederse `AI_REFUSED` döner; harcanan tokenlar yine bütçeye yazılır. Sağlayıcı hatası `AI_FAILED` (502) döner. İstemci 60 saniye zaman aşımı ve iki yeniden deneme kullanır.

## Bütçe ve kayıt

- `ai_budgets`: kiracı başına `monthlyTokenLimit`. Kayıt yoksa `AI_DEFAULT_MONTHLY_TOKENS` (varsayılan 200000) geçerlidir. 0 stüdyoyu o kiracı için durdurur.
- Bütçe istekten önce denetlenir ve bir işletme için aynı anda tek taslak yazılır (ikincisi `AI_BUSY`); yanıt için istenen en çok çıktı, ayın kalan bütçesini geçmez. Bütçeyi bitiren son istek yalnızca girdi boyu kadar aşabilir.
- `ai_usage`: her istek için tür, model, girdi ve çıktı token sayısı, çıkarılan öge sayısı, isteyen kullanıcı ve zaman. Açıklama ve taslak metni **saklanmaz**.
- Konsol: restoran detay sayfasında "Yapay zeka bütçesi" kartı (sınır, bu ay kullanılan ve kalan). Uçlar `GET /admin/ai-budgets/:restaurantId` ve `PUT /admin/ai-budgets/:restaurantId { monthlyTokenLimit }`. Değişiklik denetim kaydına `ai_budget.update` olarak yazılır.

## Ortam değişkenleri

`AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_DEFAULT_MONTHLY_TOKENS` (`.env.example`, `deploy/docker-compose.prod.yml`). Anahtar kodda ve depoda tutulmaz.

## Testler

- `packages/shared/src/ai-studio.spec.ts`: kişisel veri çıkarma (telefon, e-posta, kart, IBAN ve korunması gereken sıradan sayılar), istek doğrulaması, bütçe ayı.
- `apps/api/src/modules/ai-studio/anthropic-ai.provider.spec.ts`: SDK isteğinin biçimi (model, düşük efor, JSON şeması, ret yedeği başlığı ve parametresi) ve ret durumunun token sayılarıyla bildirilmesi; ağ kullanılmaz.
- `apps/api/test/e2e/ai-studio.e2e-spec.ts`: modül anahtarı, modele giden metinde kişisel veri olmaması, içeriksiz kullanım kaydı, taslaktan kayıt oluşmaması, e-posta konusu, menü açıklaması, doğrulama, bütçe sınırı ve konsol yetkisi.
- `apps/web/e2e/ai-studio.e2e.ts`: kapalıyken bölüm yok, açıkken taslak üretme, çıkarılan öge bildirimi, seçilen taslağın forma gelmesi, konsolda kullanım.
