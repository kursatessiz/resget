# Mutfak ekranı

Mutfaktaki bir tablette kabul edilen siparişler fiş olarak, söz verilen hazır olma saatine göre sıralı görünür. Aşçı satırları tek tek hazır olarak işaretler, bütün satırlar bitince siparişi hazır yapar. Kâğıt fişin ve "hangi sipariş önce" sorusunun yerini alır. Modül `kitchen_display` anahtarının arkasındadır (varsayılan kapalı, BETA).

## Ekran

- **Adres ve izinler:** `/panel/<slug>/mutfak`. Ekranı görmek için `orders.view`, satır işaretlemek ve Hazır düğmesi için `orders.manage` gerekir.
- **Fişler:** kabul edilmiş (`ACCEPTED`) ve hazırlanan (`PREPARING`) siparişlerdir. Bekleyen (`PLACED`) siparişler sipariş ekranında kabul edilir, mutfağa kabulden sonra düşer.
- **Sıra:** önce söz verilen hazır olma saati (`promisedReadyAt`), yoksa ileri tarihli siparişin saati, yoksa verildiği an (`sortKitchenTickets()`).
- **Fiş içeriği:**
  - Sipariş kodu ve teslim şekli.
  - Masa (varsa).
  - Hazır olacağı saat ve ileri tarihli saat.
  - Satırlar: adet, ad ve seçenekler.
  - Müşteri notu.
  - Kaç satırın hazır olduğu.
- **Gecikme:** söz verilen saat geçmişse fişte "Gecikti" rozeti çıkar. Ekran yarım dakikada bir saate göre yenilenir.
- **Canlı güncelleme:** ekran, siparişin olay akışını (`/restaurants/:id/orders/events`) dinler. Herhangi bir ekrandan gelen değişiklik tahtayı yeniden yükler; aynı anda gelen olaylar tek yüklemede toplanır. Birden fazla mutfak tableti birbiriyle uyumlu kalır.

## Satır işaretleme

- **Uç:** `POST /restaurants/:id/kitchen/items/:itemId/prepared { prepared }`. `order_items.preparedAt` alanını yazar veya siler.
- **Siparişi başlatma:** kabul edilmiş siparişte ilk işaretlenen satır siparişi hazırlanıyor durumuna alır (`ACCEPTED -> PREPARING`). Geçiş, diğer tüm ekranlardaki gibi durum makinesinden ve sipariş geçmişinden geçer.
- **Eşzamanlı işaretleme:** iki aşçı aynı anda satır işaretlerse sipariş bir kez başlar. Geçişler karşılaştır-ve-değiştir ile yazılır (`docs/SIPARIS_VE_SEVK.md` bölüm 1).
- **Geri alma:** işaret geri alınabilir. Geri almak siparişi geri taşımaz.
- **Hazır:** bütün satırlar bitince Hazır düğmesi siparişi hazır yapar (`PREPARING -> READY`, sipariş geçiş ucu). Hazır olan sipariş mutfak ekranından çıkar; servis, gel al veya kurye adımları sipariş ekranında ve sevk panosunda sürer.
- **Mutfaktan çıkmış sipariş:** satırı işaretlenemez (`404`).

## İstasyonlar

- **Tanım:** istasyon kiracı verisidir. Menü bölümü, ürünlerinin gideceği istasyonun adını taşır (`menu_categories.kitchenStation`; örneğin Izgara, Soğuk mutfak, Bar). Menü düzenleyicide her bölümün yanında "Mutfak istasyonu" bağlantısı vardır; boş bırakmak istasyonu kaldırır.
- **Seçici:** mutfak ekranının istasyon seçicisi menüde adı geçen istasyonları listeler. Bir istasyon seçilince fişlerde yalnızca o istasyonun satırları görünür ve o istasyonda satırı olmayan sipariş gösterilmez. "Tüm istasyonlar" görünümü her şeyi gösterir.
- **Sorgu anında okunur:** istasyon, siparişin satırından menü ürününün bölümüne bakılarak okunur. Bölümün istasyonu değişirse açık fişler de yeni istasyona geçer.

## Veri

- `menu_categories.kitchenStation` (boş olabilir, en çok 40 karakter).
- `order_items.preparedAt` (boş olabilir).

Migration: `20261124000000_kitchen_display`.

## Testler

- `apps/api/test/e2e/kitchen.e2e-spec.ts`:
  - Modül kapalıyken kapalı olması.
  - Fişler ve istasyon görünümü.
  - İlk satırla siparişin başlaması, geri alma, hazır ve mutfaktan çıkış.
  - İki aşçının aynı anda işaretlemesinde tek geçiş.
  - Bölüm istasyonunun kaldırılması.
- `apps/web/e2e/kitchen.e2e.ts`:
  - Menü ekranında istasyon verme.
  - İstasyon seçimi.
  - Satır işaretleme ve hazır.
