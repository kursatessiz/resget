# Öğün saatleri

İşletme menü bölümlerine servis saati verir. Örneğin kahvaltı yalnızca 07:00 ile 11:00 arası, öğle menüsü yalnızca hafta içi öğlen sipariş edilebilir. Modül `menu_dayparts` anahtarının arkasındadır (varsayılan kapalı, BETA).

## İşletme

- **Düzenleme:** menü düzenleyicide her bölümün yanında "Servis saatleri" bağlantısı vardır. İki seçenek sunulur:
  - "Restoran açıkken her zaman" (varsayılan)
  - "Yalnızca belirli saatlerde": seçilen günlere tek bir başlangıç ve bitiş saati
- **Gece yarısı:** gece yarısını geçen aralık için bitiş başlangıçtan küçük girilir.
- **Kayıt:** saatler çalışma saatleriyle aynı biçimde (`OpeningHours`) `menu_categories.availableHours` alanına yazılır. Bu yüzden aynı kural (`isOpenAt`) hem sunucuda hem sipariş sayfasında karar verir.
- **API:** `POST` ve `PATCH /restaurants/:id/menu/categories` uçları `availableHours` alanını taşır. `null` her zaman demektir. Başlangıcı bitişine eşit aralık `400` ile reddedilir.
- **Rozet:** bölüm başlığında servis saatleri rozet olarak görünür.

## Müşteri

- **Kural:** bölüm, siparişin verildiği an için değil, siparişin ait olduğu an için değerlendirilir. Hemen siparişte bu an şimdi, ileri tarihli siparişte seçilen saattir (`docs/ILERI_TARIHLI_SIPARIS.md`).
- **Saat dışında:** sipariş sayfasında bölümün altında o günün servis saatleri yazar ("Bu bölüm bugün yalnızca şu saatlerde sipariş edilebilir: 07:00 - 11:00") ve "Ekle" düğmesi görünmez.
- **Saat değişince:** müşteri başka bir saat seçerse ve sepetteki ürün o saatte sunulmuyorsa, ürünün altında uyarı çıkar ve sipariş düğmesi kapanır.
- **Sunucu kontrolü:** sunucu da kontrol eder. Masa QR'dan ve restoran sayfasından gelen siparişte saat dışındaki ürün `409 MENU_ITEM_NOT_SERVED` ile reddedilir. Personelin girdiği telefon ve kasa siparişleri, çalışma saatlerinde olduğu gibi reddedilmez.
- **Modül kapalıyken:** menü yanıtında `availableHours` boştur ve kontrol yapılmaz. Kayıtlı saatler korunur.

## Veri

`menu_categories.availableHours` (JSON; boş ise her zaman). Okunamayan değer "her zaman" sayılır. Migration: `20261121000000_menu_dayparts`.

## Testler

- `packages/shared/src/menu.spec.ts`:
  - Saatsiz ve saatli bölüm.
  - Pencere sınırları.
  - Başka gün.
  - Geçersiz aralık.
- `apps/api/test/e2e/menu-dayparts.e2e-spec.ts`:
  - Kayıt ve geçersiz aralık.
  - Modül kapalıyken etkisizlik.
  - Saat dışında siparişin reddi.
  - Saat içinde ve saatler kaldırılınca siparişin kabulü.
- `apps/web/e2e/menu-dayparts.e2e.ts`:
  - Düzenleyicide servis saati verme.
  - Sipariş sayfasında notun görünmesi ve ekleme düğmesinin gizlenmesi.
