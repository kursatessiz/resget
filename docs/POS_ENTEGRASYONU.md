# POS entegrasyonu

Restoranın kendi POS (adisyon) sistemi her yeni siparişi alır: mutfak fişi basılır, sipariş kendi raporlarına girer. POS isterse siparişi otomatik kabul eder; kabul, hazır ve ret durumlarını imzalı bildirimle geri yollar. `pos_integration` modül anahtarının arkasındadır (`docs/OZELLIK_ANAHTARLARI.md`); varsayılanı kapalıdır.

## Adaptör yapısı

Her POS bir `PosIntegrationAdapter`'dır (`packages/shared/src/pos.ts`): `verifyCredentials`, `pushOrder`, `parseWebhook`. Yeni POS eklemek yeni adaptör ve `POS_PROVIDERS` satırıdır; sipariş akışında kod yolu değildir.

| Kod | Ad | Durum |
| --- | --- | --- |
| `MOCK` | Test POS | Hazır (geliştirme ve testler) |
| `ROBOTPOS` | robotPOS | Partner anlaşması bekliyor |
| `ADISYO` | Adisyo | Partner anlaşması bekliyor |
| `SAMBAPOS` | SambaPOS | Partner anlaşması bekliyor |
| `SIMPRA` | Simpra | Partner anlaşması bekliyor |

Gerçek adaptörler POS firmalarının partner programına ve API belgesine bağlıdır (sahibin işi: anlaşma ve test hesabı). Panel bu sistemleri "yakında" olarak gösterir ve seçtirmez; API adaptörü olmayan kodu `400` ile reddeder.

MOCK adaptör: `storeId` "bad" ile başlıyorsa doğrulama başarısız olur, "down" ile başlıyorsa her gönderim reddedilir; bildirimler gövdenin `secret` anahtarıyla HMAC-SHA256 imzasını `x-mock-signature` başlığında taşır.

## Akış

1. **Bağlantı**: `PUT /restaurants/:id/pos` (`integrations.manage`, yalnızca oturum) gövde `{ providerCode, credentials, autoAccept, defaultPrepMinutes }`. Bilgiler `CredentialCipher` ile şifrelenir (AES-256-GCM, anahtar sürümlü); hiçbir yanıt şifresiz halini içermez. Doğrulama başarısızsa bağlantı `FAILED` olarak saklanır ve neden gösterilir.
2. **Gönderim**: sipariş `PLACED` olduğunda (personel siparişi, müşteri siparişi veya ödeme sonrası) POS'a bir kez gönderilir (`PosOrderSync`, sipariş başına tek satır; birden çok süreç aynı olayı görse de tek gönderim). Gönderim sipariş akışını bekletmez, arka planda çalışır.
3. **Otomatik kabul**: bağlantıda açıksa ve gönderim başarılıysa sipariş restoran adına `defaultPrepMinutes` ile kabul edilir. Bu arada bir personel siparişi ilerletmişse bir şey yapılmaz.
4. **Yeniden deneme**: başarısız gönderim 1, 2, 4, 8 dakika arayla yeniden denenir (`PosWatchdog`, dakikada bir; `ORDER_WATCHDOG=off` ile kapanır); `POS_MAX_ATTEMPTS` (5) denemeden sonra `FAILED` kalır ve panelde görünür. Sipariş her durumda panelden yönetilebilir.
5. **POS bildirimi**: `POST /webhooks/pos/:connectionId`, imza doğrulanmadan hiçbir şey yazılmaz (`400 WEBHOOK_INVALID`). Gövde `{ externalRef, kind: ACCEPTED | READY | REJECTED, prepMinutes?, reason? }`; `posEventTransition()` siparişin durumuna göre geçişi seçer (kabul yalnızca `PLACED`'ten, hazır yalnızca mutfaktayken, ret `PLACED`'te `REJECTED`, mutfakta `CANCELLED_BY_RESTAURANT`). Uygulanacak bir şey yoksa `{ applied: false }` döner; tekrar eden bildirim zararsızdır.

## Panel

`/panel/<slug>/entegrasyon` sayfasında anahtar açıkken "POS entegrasyonu" kartı: POS seçimi, mağaza kodu ve imza anahtarı, otomatik kabul ve varsayılan hazırlık süresi, POS bildirim adresi, duraklat / sürdür, bağlantıyı kaldır ve son 10 gönderimin durumu (bekliyor ve deneme sayısı, gönderildi, gönderilemedi ve hata).

## Uçlar

- `GET /restaurants/:id/pos`: sağlayıcı kataloğu ve bağlantı.
- `PUT /restaurants/:id/pos`: bağla (yalnızca oturum).
- `PATCH /restaurants/:id/pos`: `{ autoAccept?, defaultPrepMinutes?, isActive? }`.
- `DELETE /restaurants/:id/pos`: bağlantıyı kaldır (yalnızca oturum).
- `POST /webhooks/pos/:connectionId`: POS'un durum bildirimi.

Bağlama, güncelleme ve kaldırma denetim kaydına yazılır.
