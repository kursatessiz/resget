# Kurye: API ile bağlanan ayrı hizmet

Karar: platform asla kendi kurye filosunu kurmaz. Kendi filo kurmak maliyet yapısını mevcut platformlarınkine çevirir ve yüzde 1 modeli bozar (teslimat maliyeti ortalama sepetin yüzde 5 ila 9'u, platform geliri yüzde 1).

## İki kural

1. Kurye ücreti **ayrı fiyatlanan, ayrı satırda görünen** bir hizmettir. Müşteriye veya restorana açıkça yansır; komisyonun içine asla girmez (`settlement.ts`, `COURIER_COST` ve `DELIVERY_FEE` satırları).
2. Her kurye ağı `CourierProviderAdapter` arkasındadır (`packages/shared/src/courier.ts`). Yeni ağ eklemek adaptör yazmak ve `courier_providers` tablosuna satır eklemektir; sipariş akışında kod yolu açılmaz.

## Restoranın kendi kuryesi

`RESTAURANT_COURIER` modunda kurye, `courier.deliver` iznine sahip bir personeldir ve aynı uygulamayı kullanır. Sefer oluşturma, çok duraklı sıra (elle veya en kısa rota), teslim alma, yola çıkma, varış geofence'i, teslim ve canlı konum akışı `docs/SIPARIS_VE_SEVK.md` içinde anlatılır. Bu belge yalnızca üçüncü taraf kurye ağlarını kapsar.

## Teslimat modları

| `DeliveryMode` | Anlam |
|---|---|
| `RESTAURANT_COURIER` | Restoran kendi kuryesiyle teslim eder (Faz 0 varsayılanı) |
| `THIRD_PARTY_API` | Restoran anlaşmalı kurye ağından teklif alır ve kurye çağırır |
| `NONE` | Yalnızca gel al ve masaya servis |

Restoran varsayılan modunu seçer; sipariş bazında farklı olabilir.

## Adaptör arayüzü

```
quote(request)        -> teklif (ücret, ETA, geçerlilik)
dispatch(quoteId, ref)-> sağlayıcı referansı, takip adresi
cancel(providerRef)
parseWebhook(body, headers) -> olay (ASSIGNED, PICKED_UP, DELIVERED, CANCELLED, FAILED), imza doğrulanır
```

Bugün yalnızca `MOCK` adaptör vardır (mesafeye göre deterministik teklif; `apps/api/src/modules/courier/mock-courier.adapter.ts`). `CourierRegistry` adaptörleri koda göre tutar; `COURIER_PROVIDER` env değeri gerçek bir ağsa `COURIER_API_KEY` zorunludur.

## Müşteriye yansıyan ücret

Restoran `DeliveryFeePolicy` seçer (`Restaurant.deliveryFeePolicy`):

| Mod | Davranış |
|---|---|
| `PASS_THROUGH` | Teklif aynen, isteğe bağlı adıma yukarı yuvarlanarak (örn. 5 TL) |
| `FIXED` | Sabit ücret; farkı restoran karşılar veya kazanır |
| `FREE_ABOVE` | Eşik üzeri sepette ücretsiz, altında sabit |

`POST /restaurants/:id/courier/quote` teklifi, müşteri ücretini ve restoranın sübvansiyonunu birlikte döner. Platform komisyonu her durumda değişmez.

## Yaşam döngüsü

`DeliveryRequest` sipariş başına tektir: QUOTED -> REQUESTED -> ASSIGNED -> PICKED_UP -> DELIVERED (veya CANCELLED / FAILED). Nihai ücret teklif tutarından farklıysa (`finalFeeMinor`) hakedişe `ADJUSTMENT` satırı yazılır. Bu mutabakat henüz yazılmadı (bkz. "Faz 2'ye bırakılanlar"); bugün nihai ücret yalnızca kayda geçer.

## Kurye çağırma

Kurye çağırma `courier_network` modülünün parçasıdır (açık, GA). Personel `dispatch.manage` izniyle sipariş ekranından çağırır.

- **Ne zaman**: bütün koşullar sağlanmalıdır.
  - Sipariş teslimat siparişidir ve `ACCEPTED`, `PREPARING` veya `READY` durumundadır. Ağlar hazırlık sürerken çağrılmayı bekler.
  - Sipariş restoranın kendi kurye seferinde değildir.
  - Siparişte etkin bir istek yoktur.
  - Restoranın seçili, etkin ve adaptörü olan bir ağı vardır.
  - Restoranın varsayılan teslimat modu ne olursa olsun, bir siparişi ağa vermek mümkündür.
- **Çağrı**: `POST /restaurants/:id/orders/:orderId/courier-request` teklif alır ve hemen çağırır (`quote` -> `dispatch`).
  - Teklif isteği: alış noktası şube (adres, konum, şube telefonu), bırakış noktası siparişin adres anlık görüntüsü. Paket değeri müşterinin ödediği tutar, hazır olma zamanı söz verilen hazır olma anıdır.
  - İstek `REQUESTED` olur. Teklif ücreti, ETA'lar, sağlayıcı referansı ve takip adresi kaydedilir.
  - İptal edilmiş veya başarısız bir isteğin yerine yeni çağrı aynı satırı yeniden kullanır.
  - Siparişin adresinde konum yoksa veya teklif alınamazsa çağrı reddedilir (`COURIER_REQUEST_NOT_ALLOWED`, `COURIER_DISPATCH_FAILED`).
- **İptal**: `POST .../courier-request/cancel` paket alınmadan önce ağa iptal gönderir ve isteği `CANCELLED` yapar. Restoranın iptal ettiği veya reddettiği siparişin etkin isteği kendiliğinden iptal edilir.
- **Ağın bildirimleri**: `POST /webhooks/courier/:providerCode`. İmza adaptörde doğrulanır, bozuk imza 400 döner. İstek sağlayıcı referansıyla bulunur; bilinmeyen referans sessizce yok sayılır. Olaylar aynı sipariş durum makinesine bağlanır (`networkOrderSteps()`):

| Olay | İstek | Sipariş |
|---|---|---|
| `ASSIGNED` | `ASSIGNED` | `READY` ise `HANDED_TO_COURIER` |
| `PICKED_UP` | `PICKED_UP` | `OUT_FOR_DELIVERY`; mutfak henüz hazır demediyse önce `READY` |
| `DELIVERED` | `DELIVERED`, varsa nihai ücret | `DELIVERED` (aradaki adımlarla) |
| `CANCELLED` / `FAILED` | Aynı ad, neden kaydedilir | Kurye bacağındaysa `READY`'ye döner; restoran yeniden çağırır veya kendisi teslim eder |

- **Bildirim kuralları**: olaylar geri gitmez. Örneğin `PICKED_UP`'tan sonra gelen `ASSIGNED` yok sayılır. Tekrarlanan olay etkisizdir (`nextDeliveryRequestStatus()`).
- **Elle müdahale**: personel siparişi yine elle ilerletebilir. Bildirim kaybolursa bu bir yedektir.
- **Müşteri**: takip sayfası istek etkinken ağın adını ve takip bağlantısını gösterir.
- **Kurye bahşişi**: `DELIVERED` istek, bahşiş destekleyen ağda bahşişi mümkün kılar (`docs/BAHSIS.md`).
- **Panel**: sipariş kartında "Kurye çağır" düğmesi, isteğin durumu, ağın adı, ETA ve "Kurye çağrısını iptal et" bulunur. Kurye ekranı son istekleri listeler.

## Faz 2'ye bırakılanlar

- Gerçek ağ adaptörleri (ülkeye göre seçilir; imza doğrulaması adaptörün parçasıdır).
- Nihai kurye ücreti ile teklif arasındaki farkın hakedişe `ADJUSTMENT` olarak yazılması.
- Kurye ilan panosu: Türkiye'de iş ve işçi bulmaya aracılık İŞKUR özel istihdam bürosu iznine tabidir; hukuki görüş alınmadan geliştirilmez.
- Mahalle kurye havuzu (aynı bölgedeki restoranların kurye paylaşımı): daha ayırt edici ama operasyon yükü taşır; aynı hukuki görüşe bağlıdır.
