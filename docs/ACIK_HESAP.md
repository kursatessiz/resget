# Açık hesap: masada siparişler tek hesapta, hesap bölünerek ödenir

Karar (sahip): masada sipariş başına ödeme seçenek olarak kalır; yanında açık hesap vardır. Masadaki siparişler hesaba yazılır, hesap en sonda tek seferde veya bölünerek ödenir. Bölme seçenekli: eşit, ürüne göre, tutara göre. Servis ücreti yoktur (Türkiye'de alınmaz; platform da eklemez). Masada telefondan çevrim içi ödeme (müşterinin kendi payını telefonla ödemesi) bu adımda yoktur, sonraki adımdır.

Modül anahtarı `table_tabs` (varsayılan kapalı, `docs/OZELLIK_ANAHTARLARI.md`). Plan matrisinde düz modüldür (`docs/PLAN_MATRISI.md`).

## Akış

1. **Siparişi hesaba yazmak.** Masa QR sayfasında (`/m/<token>`) ödeme seçeneklerinin başında "Açık hesaba yaz" çıkar (yalnızca masaya sipariş ve modül açıkken). Garson da panelden masa siparişini hesaba yazabilir (`POST /restaurants/:id/orders` gövdesinde `tab: true`, `tableId`, `DINE_IN`). Hesaba yazılan siparişte ödeme niyeti yoktur; sipariş `PLACED` olarak normal kabul ve mutfak akışından geçer.
2. **Hesabın açılması.** Masanın açık hesabı yoksa ilk hesaba yazılan sipariş açar. Masa başına en fazla bir açık hesap vardır (`openKey` benzersiz alanı, açıkken masa kimliği, kapanınca boş). Aynı anda sipariş veren iki misafir aynı hesaba düşer.
3. **Hesabı görmek.** Siparişten sonra misafir `/hesap/<token>` sayfasına gider: ürünler, siparişlerin durumu, toplam, ödenen, kalan ve bölme hesaplayıcısı. Sayfa ad, telefon veya adres göstermez; masa QR sayfası da açık hesap varsa "Hesabı gör" bağlantısını gösterir. Bağlantı 24 karakterlik rastgele bir token taşır.
4. **Hesabı bölmek.** Hesaplayıcı (`TabSplit`, kurallar `packages/shared/src/tabs.ts`):
   - Eşit: kalan tutar kişi sayısına bölünür; bölünmeyen kuruş ilk paylara birer birer eklenir (`splitEqual()`), paylar her zaman kalanı verir.
   - Ürüne göre: her satır onu yiyen kişilere verilir, ortak satır aralarında eşit bölünür; işletmenin karşıladığı indirim (sadakat, kupon) paylara aldıkları oranda dağıtılır (`shareOf`), henüz kimseye verilmeyen satırlar ayrıca gösterilir (`splitByItems()`).
   - Tutara göre: herkes ödeyeceği tutarı yazar; toplam kalanı geçemez (`splitByAmount()`).
     Hesaplayıcı yalnızca hesaplar; para panelden tahsil edilir.
5. **Tahsil etmek.** Panelde `/panel/<slug>/hesaplar` ekranı açık hesapları listeler. Bir hesap açıldığında aynı hesaplayıcı görünür; "Bu payı tahsil et" tutarı tahsilat formuna yazar. Personel nakit, işletmenin POS'unda kart veya kapıda kabul edilen yemek kartıyla tahsil eder (`POST /restaurants/:id/tabs/:tabId/collect`, `orders.manage`). Tutar kalanı geçemez.
6. **Kapanış.** Her şey ödendiğinde ve bütün siparişler servis edildiğinde (veya iptal olduğunda) hesap kendiliğinden kapanır. Ödenmiş ama hâlâ mutfakta olan bir hesabı personel elle kapatabilir (`POST .../close`); kalanı olan hesap kapanmaz (`TAB_NOT_SETTLED`). Kapanan hesaba tahsilat yapılamaz (`TAB_CLOSED`); masanın bir sonraki hesaba yazılan siparişi yeni hesap açar.

## Para

- Açık hesaptaki her sipariş kendi hakediş anlık görüntüsünü taşır. Masaya sipariş komisyonsuzdur (`commissionBpsFor`, `docs/MUTABAKAT.md` kural 1). Parayı restoran tahsil ettiği için hesaba yazılan sipariş `OWN_POS` gibi hesaplanır: PSP kesintisi ve tevkifat sıfır, platform alacağı sıfır.
- Tahsil edilen pay, hesabın siparişlerine en eskiden başlayarak dağıtılır ve hiçbir siparişe kalanından fazla yazılmaz (`allocateTabPayment()`). Her parça o siparişte sıradan bir kasada tahsilat (`CAPTURED`, `OWN_POS`, `collectedByUserId`) olarak kaydedilir; böylece iade, rapor ve muhasebe aktarımı sipariş başına çalışmaya devam eder.
- Aynı anda yapılan iki tahsilat aynı tutarı ödeyemez: tahsilat hesap satırını kilitler (`SELECT ... FOR UPDATE`), kalanı kilit altında yeniden hesaplar.
- Sipariş başına kalan tutar, siparişin bütün tahsilatlarını toplar (kısmi tahsilatlar ve hesap payları). Bu PR'la düzeltilen hata: daha önce yalnızca son ödeme kaydı sayılıyordu, ikinci kısmi tahsilattan sonra sipariş eksik ödenmiş görünüyordu; kısmi iadeden sonra da ödenmiş sipariş borçlu görünüyordu.

## Uçlar

| Uç                                          | Yetki           | Not                                                  |
| ------------------------------------------- | --------------- | ---------------------------------------------------- |
| `GET /restaurants/:id/tabs`                 | `orders.view`   | Açık hesaplar, masa ve tutarlarla                    |
| `GET /restaurants/:id/tabs/:tabId`          | `orders.view`   | Hesap dökümü ve kasada kabul edilen ödeme şekilleri  |
| `POST /restaurants/:id/tabs/:tabId/collect` | `orders.manage` | `{ method, amountMinor, providerCode?, reference? }` |
| `POST /restaurants/:id/tabs/:tabId/close`   | `orders.manage` | Kalan sıfırsa                                        |
| `GET /public/tabs/:token`                   | herkese açık    | Masanın hesabı, kişisel veri olmadan                 |

Masa QR sayfasının `GET /public/qr/:token` yanıtı `tab: { enabled, open }` taşır; `POST /public/qr/:token/orders` gövdesinde `tab: true` (ödeme niyeti yok) hesaba yazar ve yanıttaki `tabUrl` hesabın bağlantısıdır.

## Veri

`table_tabs`: restoran, şube, masa, durum (`OPEN` / `CLOSED`), `openKey`, `publicToken`, açılış, kapanış ve kapatan kullanıcı. `orders.tabId` siparişi hesaba bağlar.

## Testler

`packages/shared/src/tabs.spec.ts` (bölme, dağıtım), `apps/api/test/e2e/tabs.e2e-spec.ts` (kapalı modül, doğrulama, ortak hesap, kişisel verisiz döküm, eşit paylarla tahsilat, fazla tahsilat reddi, elle ve kendiliğinden kapanış, eşzamanlı tahsilat, kısmi tahsilat düzeltmesi), Playwright `tabs.e2e.ts`.
