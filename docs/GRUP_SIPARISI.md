# Grup siparişi

Ofiste veya arkadaş grubunda tek sepette sipariş: biri restoranın sayfasında grup sepeti açar ve bağlantıyı paylaşır, katılan herkes kendi seçimini ekler, sepet sahibi tek sipariş verir ve tamamını öder. Siparişte daha büyük sepet ve restoranın kendi sayfasına daha çok kişi demektir. Modül `group_orders` anahtarının arkasındadır (varsayılan kapalı, BETA).

## Akış

- **Başlatma:** restoran sayfasında (`/<slug>`) "Grup siparişi başlat" kutusu çıkar (`StorefrontDTO.groupOrders`). Sahip adını yazar ve sepet açılır (`POST /public/restaurants/:slug/group-carts`). Sayfa `/<slug>/grup/<token>` adresine geçer.
- **Paylaşma ve katılma:** sahip bu sayfanın bağlantısını paylaşır. Bağlantıyı açan kişi adını yazarak katılır (`POST /public/group-carts/:token/participants`).
- **Seçim ekleme:** herkes restoranın normal sipariş sayfasını "grup modunda" görür ve yalnızca kendi seçimlerini düzenler. Değişiklikler kısa bir gecikmeyle sepete yazılır (`PUT /public/group-carts/:token/participants/:id/lines`).
- **Grup görünümü:** sayfanın üstünde kimin ne seçtiği, kişi başı ara toplam ve grup toplamı görünür. Görünüm beş saniyede bir yenilenir.
- **Sepeti kapatma:** sahip ödemeye geçmeden önce sepeti kapatabilir (`POST .../lock`, geri açmak `.../unlock`). Kapalı sepette kimse seçim değiştiremez.
- **Siparişi verme:** ödeme formunu yalnızca sahip görür. Toplam herkesin seçimlerini içerir.
  - Sipariş, tek siparişle aynı gövdeyle gönderilir (`POST /public/group-carts/:token/orders`). Sunucu ürün listesini istemciden almaz, sepetteki herkesin satırlarıyla değiştirir.
  - Sipariş restoran sayfasının normal yerleştirmesinden geçer: çalışma saatleri, teslimat bölgesi, kupon, sadakat, seçenek fiyatı ve stok gibi tek siparişin bütün kuralları geçerlidir.
- **Sonrası:** sahip takip sayfasına geçer. Diğer katılımcılar "Grup siparişi verildi" görür; takip bağlantısı yalnızca sahiptedir, çünkü adres ve iletişim bilgisi içerir.

## Güvenlik

- **Anahtar:** her tarayıcının kendi anahtarı vardır. Katılırken bir kez döner, tarayıcıda saklanır ve isteklerde `x-group-key` başlığıyla gönderilir. Sunucu yalnızca SHA-256 özetini tutar ve sabit zamanlı karşılaştırır.
- **Yetki sınırları:**
  - Kimse başkasının seçimini değiştiremez (`403 GROUP_CART_FORBIDDEN`).
  - Sepeti kapatma ve siparişi verme yalnızca sahibe açıktır.
- **Satır doğrulaması:** her satır yazılırken menüyle doğrulanır (bu restoranın ürünü, satışta, seçenekler menüdeki fiyatla; `resolveLineModifiers()`). Okurken fiyatlar bugünkü menüden hesaplanır. Satıştan kalkan bir satır "satışta değil" olarak işaretlenir ve sahibi çıkarır.
- **Çift siparişe karşı:** sipariş verilmeden önce sepet tek bir koşullu yazımla `PLACED` olarak sahiplenilir; çift tıklama iki sipariş açamaz. Yerleştirme başarısız olursa (ör. ürün satıştan kalktı) sepet kapalı olarak geri verilir ve sahip düzeltip yeniden dener.
- **Sınırlar:**
  - Sepet 6 saat açık kalır.
  - En çok 20 kişi katılabilir, kişi başına en çok 30 satır eklenebilir.
  - Uçlar istemci adresi başına oran sınırlıdır.

Ödeme sepet sahibindedir. Kişi başı ödeme (hesap bölme), masada ödeme kararıyla birlikte ele alınacaktır.

## Hatalar

- `GROUP_CART_NOT_FOUND` (404): sepet bulunamadı.
- `GROUP_CART_CLOSED` (409): sepet kapalı, verilmiş veya süresi dolmuş.
- `GROUP_CART_FULL` (409): katılımcı sınırı doldu.
- `GROUP_CART_EMPTY` (409): sepette henüz ürün yok.
- `GROUP_CART_FORBIDDEN` (403): anahtar bu işlem için yetkili değil.

## Veri

- `group_carts`: restoran, takip anahtarı (`token`), durum (`OPEN` / `LOCKED` / `PLACED`), verilen sipariş (`orderId`), bitiş zamanı.
- `group_cart_participants`: ad, sahip mi, anahtar özeti, satırlar (`OrderLineInput[]`, JSON).

Migration: `20261126000000_group_orders`.

## Testler

- `apps/api/test/e2e/group-orders.e2e-spec.ts`:
  - Modül kapalıyken kapalı olması.
  - Herkesin yalnızca kendi satırlarını düzenlemesi; uydurma fiyatın reddi.
  - Grup görünümü.
  - Yalnızca sahibin kapatıp sipariş vermesi.
  - İki eşzamanlı ödeme isteğinden yalnızca birinin geçmesi.
  - Siparişe herkesin satırlarının girmesi.
  - Boş sepet; yerleştirme başarısız olunca sepetin geri verilmesi.
- `apps/web/e2e/group-orders.e2e.ts`:
  - İki ayrı tarayıcıda sahip ve arkadaş.
  - Katılma ve seçim ekleme.
  - Sahibin sepeti kapatıp siparişi vermesi.
  - Arkadaşın "sipariş verildi" görmesi.
