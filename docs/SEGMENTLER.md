# Segmentler v2

Segmentler, kampanyaların kime gideceğini bir kural diliyle tarif eder. Restoran (ve platform kiracısı) müşteri listesini VE / VEYA gruplarıyla süzer, sonucu önizler ve kayıtlı bir segment olarak saklar. Modül `segments_v2` anahtarının arkasındadır (varsayılan kapalı, BETA) ve PRO planın kampanya aracının parçasıdır (`@RequirePlanFeature('campaigns')`).

İlk sürümün düz filtreleri (`CampaignSegmentSchema`, `docs/KAMPANYALAR.md`) ve kayıtlı filtre ön ayarları (`campaign_segments`) olduğu gibi çalışmaya devam eder. `legacySegmentToRule()` eski filtreyi aynı anlamdaki kurala çevirir; ileride eski ön ayarlar bu fonksiyonla taşınabilir.

## Kural dili

Kural bir gruptur: `{ op: 'AND' | 'OR', rules: [...] }`. Her kural ya bir koşul ya da iç içe bir gruptur. En fazla üç seviye ve toplam yirmi koşul kabul edilir (`SEGMENT_MAX_DEPTH`, `SEGMENT_MAX_CONDITIONS`). Boş grup herkese uyar.

Koşul `{ field, op, value }` biçimindedir. Alan sözlüğü ve izin verilen işleçler `packages/shared/src/segments.ts` içindedir (`SEGMENT_FIELDS`, `SEGMENT_OPERATORS`); şema, alana uymayan işleci veya değeri reddeder.

| Tür | Alanlar | İşleçler | Değer |
| --- | --- | --- | --- |
| Sayı | `orderCount`, `lifetimeGrossMinor`, `loyaltyPoints` | `gte`, `lte`, `eq` | Tam sayı; harcama minör birimde saklanır, ekranda kiracının para biriminin ana biriminde girilir |
| Gün | `lastOrderAt`, `firstOrderAt`, `createdAt` | `within` (son N gün içinde), `notWithin` (son N gündür yok) | 1 ile 3650 arası gün |
| Etiket | `tags` | `hasAny`, `hasAll`, `hasNone` | Etiket listesi |
| Liste | `firstChannel` (sipariş kanalı), `consentChannel` (izinli kanal) | `in`, `notIn` | Sabit değerlerden liste |
| Metin | `city`, `district`, `source` | `eq` (büyük küçük harf duyarsız), `contains` | Metin |
| Kimlik | `stageId` (CRM aşaması) | `eq`, `notEq` | Aşama kimliği |
| Evet / hayır | `isBusiness`, `hasEmail` | `is` | `true` / `false` |

"Değil" biçimleri değeri olmayanı da kapsar: `notWithin` hiç sipariş vermemiş kişiyi, `notIn` ilk kanalı bilinmeyeni, `notEq` aşaması olmayanı içerir. Silinmiş hesaplar (`User.deletedAt`) hiçbir segmentte yer almaz. Kural, API'de `segment-compiler.ts` ile tek bir Prisma sorgusuna derlenir; sorgu her zaman `restaurantId` ile başlar.

## Dinamik ve statik segment

- **Dinamik**: yalnızca kural saklanır. Sayı, önizleme ve kampanya alıcıları her kullanımda o anki verilerden yeniden hesaplanır.
- **Statik**: kaydedildiği anda kurala uyanlar `segment_members` tablosuna yazılır (anlık görüntü). Yeni müşteriler ancak "Anlık görüntüyü yenile" ile eklenir; kural değişirse anlık görüntü yeniden alınır. Sayı, anlık görüntünün büyüklüğüdür.

Türü kayıttan sonra değiştirmek yerine yeni segment oluşturulur. Ad kiracı başına tekildir (`SEGMENT_NAME_TAKEN`).

## Önizleme

`POST preview` bir kuralı kaydetmeden değerlendirir: kaç kişinin uyduğu, her kanalda (`SMS`, `CALL`, `EMAIL`, `WHATSAPP`) şu an ulaşılabilir olan sayı (rıza v2'nin `consentChannels` alanı, `docs/RIZA.md`) ve son sipariş tarihine göre en fazla on kişilik örnek. Örnekte ad yalnızca `customers.contact.view` izni olan kullanıcıya gösterilir.

## Kampanyada hedef segment

Kampanya oluştururken veya düzenlerken `segmentId` verilebilir (`CreateCampaignSchema`). Verildiğinde alıcılar o segmentten gelir ve satır içi filtreler yok sayılır; yine yalnızca kampanyanın kanalında izni olanlara gönderilir. Kampanya segmenti kopyalamaz, ona bağlanır: dinamik segment gönderim başladığında değerlendirilir, statik segment o anki anlık görüntüsüyle kullanılır.

- Segment başka bir kiracınınsa veya yoksa `SEGMENT_NOT_FOUND`; modül kapalıysa `FEATURE_DISABLED`.
- Taslak, zamanlanmış veya gönderilmekte olan bir kampanyanın hedeflediği segment silinemez (`SEGMENT_IN_USE`). Gönderilmiş kampanyalarda bağ boşaltılır.
- Bağlı segment bir şekilde kaybolursa kampanya kimseye gitmez; asla satır içi filtrelere (boş filtre herkes demektir) geri düşmez.

## API

`/restaurants/:restaurantId/segments`, `@RequireFeature('segments_v2')` ve `@RequirePlanFeature('campaigns')`:

- `GET` (`campaigns.view`): `{ currency, items }`; her segmentin türü, kuralı, sayısı ve anlık görüntü zamanı.
- `POST preview` (`campaigns.view`): `{ rule }`, yanıt `{ count, reachable, sample }`.
- `POST` (`campaigns.manage`): `{ name, kind, rule }`; statik segmentin anlık görüntüsü hemen alınır.
- `GET :id` (`campaigns.view`), `PATCH :id` (`campaigns.manage`, ad ve / veya kural).
- `POST :id/snapshot` (`campaigns.manage`): yalnızca statik segment (`SEGMENT_NOT_STATIC`).
- `DELETE :id` (`campaigns.manage`): kullanımdaysa `SEGMENT_IN_USE`.

## Ekranlar

- `/panel/<slug>/segmentler` (`campaigns.view`, modül açık; Temel planda plan kuralı): kural kurucu (VE / VEYA, alt grup, koşul ekle ve kaldır), önizleme (sayı, kanal başına ulaşılabilirlik, örnek kişiler), ad ve türle kaydetme, düzenleme, anlık görüntü yenileme, silme. CRM açıksa ve kullanıcı satış hattını görebiliyorsa aşama alanı listelenir.
- `/pazarlama/segmentler`: aynı ekran platform kiracısında.
- Kampanya formu: modül açıkken "Hedef segment" seçimi; seçildiğinde satır içi filtreler gizlenir, kampanya listesinde hedef segment adı görünür.

## Veri

`segments` (kiracı, ad, tür, kural JSON, üye sayısı, anlık görüntü zamanı; `restaurantId + name` tekil), `segment_members` (segment ve müşteri, ikisi de silinince düşer) ve `campaigns.segmentId` (silinince boşalır). Migration: `20261104000000_segments_v2`.

## Testler

- `packages/shared/src/segments.spec.ts`: alan ve değer doğrulaması, derinlik ve koşul sınırı, eski filtrenin dönüşümü.
- `apps/api/test/e2e/segments-v2.e2e-spec.ts`: modül anahtarı, iç içe VE / VEYA, "değil" biçimleri, kanal başına ulaşılabilirlik, geçersiz kural, dinamik ve statik davranış, anlık görüntü, kampanya hedefleme ve silme koruması.
- `apps/web/e2e/segments.e2e.ts`: kapalıyken 404, kural kurma, önizleme, statik segment kaydı ve yenileme, kampanyada seçim.
