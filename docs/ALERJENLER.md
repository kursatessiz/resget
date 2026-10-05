# Alerjen ve beslenme etiketleri

İşletme menü ürünlerine yasal alerjenleri ve beslenme etiketlerini ekler. Müşteri bunları sipariş sayfasında görür ve seçtiği alerjenleri içeren ürünleri gizleyebilir.

Modül `allergens` anahtarının arkasındadır (varsayılan kapalı, BETA). Katalog `packages/shared/src/allergens.ts` içindedir.

## Katalog

**Alerjenler.** Gıda etiketleme mevzuatının saydığı 14 alerjen (AB 1169/2011 Ek II; Türk Gıda Kodeksi etiketleme yönetmeliği aynı listeyi izler):

- gluten
- kabuklu deniz ürünleri
- yumurta
- balık
- yer fıstığı
- soya
- süt
- sert kabuklu yemişler
- kereviz
- hardal
- susam
- sülfitler
- acı bakla (lupin)
- yumuşakçalar

Liste yasayla belirlendiği için kod içinde sabittir. Adlar i18n kataloğundan gelir (`allergens.name.<anahtar>`).

**Beslenme etiketleri:**

- vejetaryen
- vegan
- glutensiz
- laktozsuz
- acılı

Bunlar işletmenin beyanıdır (`allergens.diet.<anahtar>`). Sertifika gerektiren beyanlar (örneğin helal) bilerek listede yoktur.

## İşletme

- **Ürün düzenleyici:** menü düzenleyicide her ürünün altında alerjen ve etiket kutuları vardır (modül açıkken).
- **API:** `allergens` ve `dietaryTags` alanları ürün oluşturma ve güncelleme uçlarında taşınır (`POST` ve `PATCH /restaurants/:id/menu/items`). Bilinmeyen veya tekrarlanan değer `400` ile reddedilir. Değerler katalog sırasıyla saklanır ve döner.
- **Çelişki uyarısı:** seçilen etiket alerjenlerle çelişiyorsa düzenleyici uyarır (`dietaryConflicts()`). Örnekler: süt veya yumurta içeren vegan ürün, gluten içeren glutensiz ürün, süt içeren laktozsuz ürün, balık veya deniz ürünü içeren vejetaryen ürün. Kayıt engellenmez; karar işletmenindir.
- **Sorumluluk:** bilginin doğruluğundan işletme sorumludur. Düzenleyici bunu açıkça söyler.
- **Modül kapalıyken:** alanlar yine saklanabilir, ama müşteriye gösterilmez.

## Müşteri

- **Gösterim:** sipariş sayfasında (restoran sayfası ve masa QR menüsü) her ürünün altında etiketler rozet olarak, alerjenler "İçerir: ..." satırı olarak görünür.
- **Filtre:** "Şunları içermesin" filtresi yalnızca menüde geçen alerjenleri listeler. Seçilen alerjenleri içeren ürünler gizlenir (`avoidsAllergens()`). Bir bölümdeki her ürün gizlenirse bu söylenir.
- **Uyarı:** sayfada, bilginin işletme tarafından verildiği ve ciddi alerjisi olanın sipariş öncesi işletmeye danışması gerektiği yazar.
- **API:** menü yanıtında her ürün `allergens` ve `dietaryTags` taşır. Modül kapalıyken ikisi de boştur.

## Veri

`menu_items.allergens` ve `menu_items.dietaryTags` (metin dizileri; varsayılan boş). Okurken bilinmeyen değerler atılır ve katalog sırası korunur (`allergensFrom()`, `dietaryTagsFrom()`). Migration: `20261120000000_menu_allergens`.

Menü CSV içe aktarımı bu alanları henüz taşımaz.

## Testler

- `packages/shared/src/allergens.spec.ts`:
  - Okuma sırası ve bilinmeyen değerler.
  - Giriş doğrulaması.
  - Çelişkiler.
  - Filtre.
- `apps/api/test/e2e/menu-allergens.e2e-spec.ts`:
  - Kayıt ve güncelleme.
  - Bilinmeyen ve tekrarlanan değerin reddi.
  - Modül kapalıyken müşteriye gösterilmemesi.
  - Restoran sayfasında ve masa menüsünde gösterim.
- `apps/web/e2e/menu-allergens.e2e.ts`:
  - Düzenleyicide alerjen ve etiket seçimi.
  - Çelişki uyarısı.
  - Sipariş sayfasında gösterim.
  - Filtreyle ürünün gizlenmesi.
