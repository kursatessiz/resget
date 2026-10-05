# Menü stok takibi

Restoran sınırlı sayıda hazırladığı ürünlerin (günün yemeği, tatlı tepsisi, kampanya ürünü) porsiyon sayısını girer. Her siparişte stok düşer, sıfıra inince ürün sipariş sayfasında satışta değil görünür, iptal edilen siparişin porsiyonu geri gelir. Modül `menu_stock` anahtarının arkasındadır (varsayılan kapalı, BETA).

## Kurallar

- **Sayılan ürün:** `menu_items.stockQuantity` boşsa ürün sayılmaz (sınırsız). Bir sayı girilirse o kadar porsiyon kalmıştır. Menü düzenleyicide ürün formundaki "Stok (porsiyon)" alanından girilir; boş bırakmak saymayı durdurur.
- **Düşme:** sipariş oluşturulurken, siparişin işleminin (transaction) içinde düşer. Her ürün için tek bir koşullu yazım yapılır ("stok istenen adetten azsa düşme"). Aynı anda gelen iki misafir son porsiyonu ikisi birden alamaz.
- **Yetmeyen stok:** sipariş `409 MENU_ITEM_SOLD_OUT` ile reddedilir ve hiçbir şey düşmez. Aynı ürün birden fazla satırdaysa adetler toplanır.
- **Satır kaydı:** her satır düştüğü adedi tutar (`order_items.stockTaken`).
- **Geri verme:** sipariş reddedilir veya iptal edilirse (`REJECTED`, `CANCELLED_BY_RESTAURANT`, `CANCELLED_BY_CUSTOMER`) satırın düştüğü adet ürüne bir kez geri eklenir. Geçişler karşılaştır-ve-değiştir ile yazıldığı için iki kez eklenemez.
- **Geri verilmeyenler:**
  - Tamamlandıktan sonra iade edilen sipariş: yemek servis edilmiştir.
  - Ürün sayılmaktan çıkarılmışsa geri ekleme yapılmaz.
- **Modül kapalıyken:** hiçbir şey düşmez ve sipariş sayfası stoğu göstermez. Kayıtlı sayılar korunur.

## Sipariş sayfası

- **Sıfırdaki ürün:** sayılan ve sıfırda olan ürün "Şu anda satışta değil" rozetiyle görünür ve sepete eklenemez (`StorefrontItemDTO.isAvailable`).
- **Az kalan ürün:** en çok `LOW_STOCK_THRESHOLD` (5) porsiyon kalmışsa ürünün yanında "Son N porsiyon" yazar (`stockLeft`).

## Panel

- **Rozet:** menü düzenleyicide sayılan ürünün yanında "Stok: N" veya "Tükendi" rozeti çıkar.
- **Stok yenileme:** ürün formunda yeni sayı girilir.

## Veri

- `menu_items.stockQuantity` (boş olabilir).
- `order_items.stockTaken` (varsayılan 0).

Migration: `20261125000000_menu_stock`.

## Testler

- `apps/api/test/e2e/menu-stock.e2e-spec.ts`:
  - Modül kapalıyken saymama.
  - Düşme ve yetmeyen stok.
  - Son porsiyon için üç paralel siparişten yalnızca birinin geçmesi.
  - Sıfırda satışta değil görünme.
  - Retle geri gelme; tamamlanan siparişte gelmeme.
  - Saymayı durdurma.
- `apps/web/e2e/menu-stock.e2e.ts`:
  - Ürün formunda stok girme.
  - Panel rozeti.
  - Sipariş sayfasında "Son 2 porsiyon".
