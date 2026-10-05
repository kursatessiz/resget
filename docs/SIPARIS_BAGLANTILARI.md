# Sipariş bağlantıları

Restoran, sipariş sayfasına (`/<slug>` veya doğrulanmış kendi alan adı) giden bağlantıyı Instagram, Facebook, WhatsApp, Google ve TikTok'a ayrı ayrı yerleştirir ve hangi kanalın kaç sipariş getirdiğini görür. Böylece müşteri, restoranın sosyal hesabından veya Google'daki profilinden doğrudan restoranın kendi sayfasına gelir: komisyon yüzde 1'dir ve müşteri restoranın listesine girer. Modül `ordering_links` anahtarının arkasındadır (varsayılan kapalı, BETA).

## Bağlantı

- **Biçim:** her kanalın bağlantısı sipariş sayfasının adresine şu parametreler eklenerek kurulur (`orderingLink()`):
  - `via=<kanal>`: kanal adı.
  - `utm_source=<kanal>`.
  - `utm_medium`: Instagram, Facebook ve TikTok için `social`; WhatsApp için `messaging`; Google için `business_profile`.
  - `utm_campaign=ordering_link`.
- **Kanallar:** `ORDER_SOURCES` sabit bir katalogdur (`packages/shared/src/ordering-links.ts`). Her kanalın kendine özgü bir yerleştirme tarifi vardır; adlar ve tarifler i18n kataloğundan gelir.
- **Hangi adres:** restoranın doğrulanmış kendi alan adı varsa bağlantı oraya, yoksa `PUBLIC_APP_URL/<slug>` adresine gider.
- **Kendi kampanyaları:** restoran aynı parametreyle kendi bağlantısını da yazabilir. Bilinmeyen bir `via` değeri yok sayılır.

## Ölçüm

- **Siparişe yazılır:** sipariş sayfası `via` değerini adresten okur ve siparişle gönderir (`PublicOrderSchema.source`). Sunucu bu değeri yalnızca şu koşullarda siparişin kaynağı olarak saklar (`orders.source`):
  - Modül açık.
  - Sipariş restoran sayfasından gelmiş.
- **Masa QR:** masa QR siparişi kendi kanalıdır; orada gelen değer yok sayılır.
- **Gizlilik:** bu ölçüm çerez veya ziyaretçi kimliği kullanmaz ve izin bandına bağlı değildir. Değer yalnızca sayfa açıkken bellekte durur ve siparişin kendisiyle birlikte kaydedilir. Bir siparişin hangi bağlantıdan verildiği sipariş verisidir, kişiyi siteler arasında izlemez.
- **Atıf modülüyle ilişki:** aynı bağlantıdaki UTM etiketleri, atıf modülü (`docs/ATIF.md`) açıksa ve ziyaretçi ölçüme izin verdiyse ayrıca ziyaret kaydına girer.
- **Geçersiz değer:** katalog dışındaki bir değer `400` ile reddedilir. Sayfa yalnızca katalogdaki değeri gönderir.

## Panel

- **Ekran ve uç:** `/panel/<slug>/siparis-baglantilari`, `GET /restaurants/:id/ordering-links` (`reports.view`).
- **Her kanal için:**
  - Bağlantı (salt okunur alan ve kopyala düğmesi).
  - Nereye yapıştırılacağı.
  - Son 30 günde o bağlantıdan gelen sipariş sayısı ve müşteriden alınan tutar.
- **Sayılmayanlar:** ödemesi tamamlanmamış, iptal edilmiş, reddedilmiş ve tamamen iade edilmiş siparişler.
- **Bağlantısız siparişler:** aynı sürede sipariş sayfasına bağlantısız gelen sipariş sayısı da yazılır.
- **Sipariş kartı:** bağlantıdan gelen siparişin kartında "Instagram bağlantısından" gibi bir rozet görünür (`OrderSummaryDTO.source`).

## Kanallara yerleştirme

| Kanal | Yer |
|---|---|
| Instagram | Profil düzenleme ekranındaki bağlantılar bölümü; hikayelerde bağlantı çıkartması |
| Facebook | Sayfanın işlem düğmesi (sipariş ver) ve gönderiler |
| WhatsApp | WhatsApp Business karşılama ve uzakta mesajı, profildeki web sitesi alanı, durum paylaşımı |
| Google | Google İşletme Profili, yemek siparişi bölümünde teslimat ve gel al bağlantısı |
| TikTok | İşletme hesabının profil bağlantısı |

Bu sürümde bağlantılar kanallara elle yerleştirilir. Google İşletme Profili API'siyle otomatik yerleştirme ve WhatsApp'ta sohbet içinde sipariş sonraki adımlardır.

## Veri

`orders.source` (boş olabilir; `ORDER_SOURCES` anahtarlarından biri). Migration: `20261123000000_order_source`.

## Testler

- `packages/shared/src/ordering-links.spec.ts`:
  - Parametreden kanal okuma.
  - Bağlantının aynı kanala geri okunması.
  - UTM etiketleri.
- `apps/api/test/e2e/ordering-links.e2e-spec.ts`:
  - Modül kapalıyken ekranın kapalı olması ve kaynağın saklanmaması.
  - Kaynağın saklanması; bilinmeyen değerin reddi; masa QR'da yok sayılması.
  - Sipariş listesinde kaynağın görünmesi.
  - Kanal başına sayım ve tutar.
  - Reddedilen siparişin sayılmaması.
- `apps/web/e2e/ordering-links.e2e.ts`:
  - Instagram bağlantısıyla misafir siparişi.
  - Sipariş kartında rozet.
  - Ekranda sayımın artması.
