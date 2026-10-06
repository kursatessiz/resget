# Açık hesap: masada siparişler tek hesapta, hesap bölünerek ödenir

Karar (sahip): masada sipariş başına ödeme seçenek olarak kalır; yanında açık hesap vardır. Masadaki siparişler hesaba yazılır, hesap en sonda tek seferde veya bölünerek ödenir. Bölme seçenekli: eşit, ürüne göre, tutara göre. Servis ücreti yoktur (Türkiye'de alınmaz; platform da eklemez). Misafir kendi payını telefondan kartla da ödeyebilir ("Telefondan pay ödemesi").

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

## Telefondan pay ödemesi

Misafir `/hesap/<token>` sayfasındaki hesaplayıcının verdiği payı (eşit, ürüne göre veya tutara göre) ya da kalanın tamamını telefonundan kartla öder.

- **Kimin hesabına**: hesaba yazılan sipariş `OWN_POS` gibi hesaplanır (aşağıda "Para"). Bu yüzden telefondan ödeme yalnızca restoranın kendi POS'u üzerinden alınır. Restoranın aktif POS bağlantısı yoksa, çevrim içi ödeme kapalıysa veya restoran `PLATFORM_PSP` modundaysa seçenek görünmez (`payOnline`).
- **Başlatma**: `POST /public/tabs/:token/pay` (`{ amountMinor, returnUrl }`, hız sınırlı). Tutar hesabın o anki kalanını geçemez (`PAYMENT_STATE_INVALID`).
  - Bir `TabPayment` kaydı açılır ve POS'un hosted ödeme sayfası başlatılır. Sağlayıcıya giden referans bu kaydın kimliğidir; kart numarası platforma girmez.
- **Tahsilat**: POS bağlantısının webhook'u referansı tanır (`docs/BAHSIS.md` ile aynı yönlendirme).
  - Tahsil edilen tutar, kasadaki tahsilat gibi hesap satırı kilitlenerek siparişlere en eskiden dağıtılır (`allocateTabPayment()`).
  - Her parça siparişte `ONLINE_CARD` yöntemiyle, `CAPTURED` ve `OWN_POS` olarak, sağlayıcının işlem referansıyla kaydedilir. Böylece sipariş başına iade POS üzerinden çalışır.
  - Tekrarlanan bildirim etkisizdir. Her şey ödenip servis edildiyse hesap kendiliğinden kapanır.
- **Fazla ödeme**: misafir öderken kasada da tahsilat yapıldıysa, kalanı aşan kısım (`excessMinor`) hemen POS üzerinden iade edilir (`excessRefundedAt`). İade başarısız olursa kayıtta kalır ve loglanır.
- **Sağlayıcı panelindeki iade ve chargeback**: payın tamamı POS sağlayıcısının kendi panelinden iade edilirse veya kart sahibinin bankası geri alırsa, bildirim aynı referansla gelir ve pay kendiliğinden siparişlere işlenir:
  - Payın ödediği her sipariş parçası, panelden yapılan iade gibi kaydedilir. Kaynak sağlayıcı iadesinde `PROVIDER`, chargeback'te `CHARGEBACK` olur.
  - Parçanın kalan tutarı iade satırına yazılır. Komisyon payı `docs/MUTABAKAT.md` kurallarıyla döner; yük restoranındır.
  - Ödenecek bir şeyi kalmayan sipariş `REFUNDED` olarak kapanır. Hesaptaki diğer paylar ve kasadaki tahsilatlar yerinde kalır.
  - Pay kaydı `REFUNDED` veya `CHARGED_BACK` olur. Henüz iade edilememiş fazla ödeme varsa, sağlayıcının tam iadesi onu da kapsadığı için kapatılır.
  - Bildirim bir kez işlenir; tekrarı etkisizdir. Personel daha önce bir siparişi kısmen iade ettiyse yalnızca kalanı işlenir.

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
| `POST /public/tabs/:token/pay`              | herkese açık    | Payı POS'un hosted sayfasında kartla öder (hız sınırlı) |

Masa QR sayfasının `GET /public/qr/:token` yanıtı `tab: { enabled, open }` taşır; `POST /public/qr/:token/orders` gövdesinde `tab: true` (ödeme niyeti yok) hesaba yazar ve yanıttaki `tabUrl` hesabın bağlantısıdır.

## Veri

`table_tabs`: restoran, şube, masa, durum (`OPEN` / `CLOSED`), `openKey`, `publicToken`, açılış, kapanış ve kapatan kullanıcı. `orders.tabId` siparişi hesaba bağlar. `tab_payments`: telefondan başlatılan pay ödemesi (tutar, para birimi, durum, sağlayıcı ve referansı, tahsil anı, iade edilen fazla tutar).

## Testler

`packages/shared/src/tabs.spec.ts` (bölme, dağıtım), `apps/api/test/e2e/tabs.e2e-spec.ts` (kapalı modül, doğrulama, ortak hesap, kişisel verisiz döküm, eşit paylarla tahsilat, fazla tahsilat reddi, elle ve kendiliğinden kapanış, eşzamanlı tahsilat, kısmi tahsilat düzeltmesi), Playwright `tabs.e2e.ts`.
