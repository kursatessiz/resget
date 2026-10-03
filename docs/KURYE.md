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

`DeliveryRequest` sipariş başına tektir: QUOTED -> REQUESTED -> ASSIGNED -> PICKED_UP -> DELIVERED (veya CANCELLED / FAILED). Nihai ücret teklif tutarından farklıysa (`finalFeeMinor`) hakedişe `ADJUSTMENT` satırı yazılır.

## Faz 2'ye bırakılanlar

- Gerçek ağ adaptörleri ve webhook imza doğrulaması (ülkeye göre seçilir).
- Kurye ilan panosu: Türkiye'de iş ve işçi bulmaya aracılık İŞKUR özel istihdam bürosu iznine tabidir; hukuki görüş alınmadan geliştirilmez.
- Mahalle kurye havuzu (aynı bölgedeki restoranların kurye paylaşımı): daha ayırt edici ama operasyon yükü taşır; aynı hukuki görüşe bağlıdır.
