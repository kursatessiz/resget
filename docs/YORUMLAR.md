# Herkese açık yorumlar ve işletme yanıtı

Karar (sahip, "5-B"): yorumlar herkese açıktır ve işletme herkese açık yanıt verir. Müşteri yorumunu bir gün, işletme yanıtını bir gün düzenleyebilir. Tüm yorumlar gösterilir (puana göre süzme yoktur). Ad kısaltılır, kişisel bilgi gizlenir; uygunsuz yorumu süper admin kaldırır, işletme bildirebilir.

Modül anahtarı `public_reviews` (varsayılan kapalı, `docs/OZELLIK_ANAHTARLARI.md`). Değerlendirmenin kendisi (`docs/VITRIN.md`, "Değerlendirme") değişmez: tamamlanan sipariş, bir kez, 7 günlük pencerede puanlanır. Modül, mevcut `order_ratings` satırlarını işletme sayfasında yayınlar. Kurallar `packages/shared/src/reviews.ts`.

## İşletme sayfası

`/<slug>` sayfasında menünün altında "Değerlendirmeler" bölümü: ortalama ve sayı, ardından yorumlar en yeniden eskiye, sayfa başına 20 (`GET /public/restaurants/:slug/reviews?cursor=`).

- Her değerlendirme gösterilir, yorumsuz olanlar dahil.
- Yazar kısaltılmış adla görünür: ad ve soyadın baş harfi ("Ayse Y."). Baş harf restoranın diliyle büyütülür (Türkçede "i" -> "İ"). Ad yoksa "Misafir" yazar (`reviewAuthorName()`).
- Yorum metnindeki telefon, e-posta, kart ve IBAN numaraları ile bağlantılar gizlenir (`scrubReviewText()`, yapay zeka stüdyosunun maskeleme kuralları ve bağlantı maskesi). Gizleme gösterimde yapılır; işletme ve platform yorumu yazıldığı gibi görür.
- Düzenlenmiş yorumda "düzenlendi" yazar; işletmenin yanıtı yorumun altında görünür.

## Müşteri: bir gün düzenleme

Takip sayfası değerlendirmeyi, işletmenin yanıtını ve pencere açıkken "Değerlendirmeyi düzenle" düğmesini gösterir. Puan ve yorum, değerlendirmeden sonraki 24 saat içinde değiştirilebilir (`PATCH /public/orders/:token/rating`, oran sınırlı). Süre dolunca `REVIEW_EDIT_CLOSED`. Puan değişince restoranın ortalaması da değişir (kaldırılmış yorum hariç). Takip anlık görüntüsündeki `rating` artık `editedAt`, `editableUntil` ve `reply` taşır.

## İşletme: yanıt ve bildirim

Panelde `/yorumlar` ekranı (okuma `customers.view`, yanıt ve bildirim `customers.manage`):

- **Yanıt**: herkese açıktır. İlk yazıldıktan sonra 24 saat düzenlenebilir, sonra kilitlenir (`PUT /restaurants/:id/reviews/:ratingId/reply`).
- **Bildirim**: kurala aykırı bir yorum bir kez platforma bildirilir (`POST .../report`). Nedenler: hakaret, kişisel bilgi, reklam veya spam, siparişle ilgisiz, diğer. İkinci bildirim `REVIEW_ALREADY_REPORTED` ile reddedilir.
- Ekran yorumun durumunu gösterir: inceleniyor, incelendi ve yayında kaldı, platform kaldırdı.
- İşletme yorumu düzenleyemez veya silemez.

## Platform: moderasyon

Konsolda `/admin/yorumlar` (yalnızca süper admin):

- **Bildirilenler**: bekleyen bildirimler.
  - "Yayından kaldır" yorumu işletme sayfasından ve puan ortalamasından çıkarır, bildirimi kapatır.
  - "Bildirimi kapat" yorumu yayında bırakır.
- **Kaldırılanlar**: "Yayına geri al" yorumu ve puanını geri getirir.
- Her karar not alabilir ve denetim kaydına yazılır (`review.hide`, `review.restore`, `review.dismiss`).
- Uç: `POST /admin/reviews/:id/decision` (`HIDE`, `RESTORE`, `DISMISS`); karar verilecek bir şey yoksa reddedilir.

## Kişisel veri

Hesap silindiğinde yorum metni silinir ve kullanıcının adı boşaltılır (`docs/KISISEL_VERI.md`); puan kalır, yazar "Misafir" görünür. Herkese açık uç telefon veya tam ad döndürmez.

## Veri

`order_ratings` satırına eklenenler:

- `editedAt`.
- İşletme yanıtı: `reply`, `replyCreatedAt`, `replyEditedAt`, `replyByUserId`.
- Bildirim: `reportReason`, `reportNote`, `reportedAt`, `reportedByUserId`, `reportResolvedAt`.
- Kaldırma: `hiddenAt`, `hiddenReason`, `hiddenByUserId`.

Kaldırma ve geri alma restoranın `ratingSum` / `ratingCount` toplamını günceller.

## Testler

- `packages/shared/src/reviews.spec.ts`: kısaltılmış ad, maskeleme, pencere.
- `apps/api/test/e2e/reviews.e2e-spec.ts`: kapalı modül, kısaltılmış ad ve maskeleme, müşteri düzenlemesi ve süre sonu, yanıt ve kilit, bildirim, kaldırma ve geri alma, bildirimi kapatma.
- Playwright `reviews.e2e.ts`.
