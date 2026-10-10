# Teslimat kodu

Restoranın kendi kuryesiyle yapılan eve teslimatta teslimin doğru kişiye yapıldığını kanıtlar. Müşteri takip ekranında dört haneli bir kod görür, kurye kapıda bu kodu ister ve uygulamaya girer. Yanlış kişiye bırakılan veya hiç teslim edilmeden "teslim edildi" işaretlenen sipariş tartışmalarını azaltır; eksik ürün bildirimlerinde (`docs/ODEME.md`) restorana kanıt sağlar. Modül `delivery_pin` anahtarının arkasındadır (varsayılan kapalı, BETA).

## Kod

- **Oluşturma:** her eve teslim siparişi yerleştirildiği anda `crypto.randomInt` ile dört haneli bir kod alır (`orders.deliveryCode`). Gel-al ve masa siparişlerinde kod yoktur.
- **Modülden bağımsız:** kod modül kapalıyken de oluşturulur. Böylece modül açıldığında yoldaki siparişler de kodla teslim edilebilir.
- **Gösterim koşulları:** kod takip yanıtında (`GET /public/orders/:token`, `OrderTrackingDTO.deliveryCode`) yalnızca şu koşulların hepsi sağlanınca yer alır:
  - Modül açık.
  - Ödeme bekleniyor durumunda değil.
  - Sipariş henüz bitmemiş (teslim, iptal veya ret değil).
  - Sipariş üçüncü taraf kurye ağına verilmemiş. Ağın kuryesi bizim uygulamamızı kullanmaz.
- **Teslimden sonra:** kod gizlenir.
- **Kod kimde görünür:** yalnızca takip bağlantısına sahip müşteride görünür. Sevk panosu, kurye ekranı ve sipariş listesi kodu hiçbir zaman göstermez. Takip bağlantısı da personel sipariş detayında yalnızca `customers.contact.view` izni olanlara (sahip, müdür) verilir; kurye ve mutfak rolleri bağlantıyı alıp kodu okuyamaz.

## Kurye

- **Kod girişi:** uygulamada durak "Varıldı" durumundayken "Teslim ettim" düğmesinin üstünde kod alanı çıkar. Düğme dört hane girilmeden açılmaz.
- **Uç:** `POST /restaurants/:id/courier/me/trips/:tripId/stops/:stopId/deliver { code }`.
- **Hatalar:**
  - Kod yoksa: `400 DELIVERY_CODE_REQUIRED`.
  - Yanlış kod: `400 DELIVERY_CODE_INVALID`.
  - Biçim hatası (dört rakam değil): `400`.
- **Deneme sınırı:** kuryenin her denemesi durak başına sayılır (`delivery_stops.codeAttempts`). Beş denemeden sonra durak kilitlenir; doğru kod da `409 DELIVERY_CODE_LOCKED` alır.
- **Sınır nasıl korunur:** sayaç tek bir koşullu yazımla artar ("deneme beşten azsa bir artır"). Bu sayede aynı anda gönderilen tahminler eski sayıyı okuyup sınırı aşamaz.
- **Kilitli durak:** uygulamada kod alanı yerine "Teslimi restoran panelden onaylayabilir" uyarısı görünür.
- **Eski siparişler:** modül açılmadan önce yerleştirilmiş ve kodu olmayan sipariş kodsuz teslim edilir; müşteri hiç kod görmemiştir.

## Restoran

- **Personel teslimi:** `dispatch.manage` iznine sahip personel sevk panosundan kodsuz teslim edebilir. Kilitli durak için tek yol budur.
- **Kanıt kaydı:** her teslim nasıl kanıtlandığını kaydeder (`delivery_stops.proof`):
  - `PIN`: doğru müşteri koduyla.
  - `STAFF`: personel onayıyla.
  - Boş: modül kapalıyken veya kodsuz eski siparişte.
- **Sevk panosu:** durak satırında kanıt ("Müşteri koduyla teslim edildi" / "Personel onayıyla teslim edildi") yazar. Kilitli durakta "Kurye çok fazla yanlış kod girdi; teslimi siz onaylayın" uyarısı çıkar (`DeliveryStopDTO.proof`, `codeLocked`).
- **Modül kapalıyken:** teslim eskisi gibi kodsuz yapılır ve kanıt kaydedilmez.

## Veri

- `orders.deliveryCode` (boş olabilir).
- `delivery_stops.proof` (`PIN` / `STAFF`, boş olabilir).
- `delivery_stops.codeAttempts` (varsayılan 0).

Migration: `20261122000000_delivery_pin`. Kod düz saklanır: ömrü tek bir teslimattır, takip bağlantısı zaten koda erişim demektir ve tahmin sınırı kaba kuvveti beş denemeyle (on binde beş) sınırlar.

## Testler

`apps/api/test/e2e/delivery-pin.e2e-spec.ts`:
- Kodun oluşturulması; modül kapalıyken gizli, açıkken görünür olması.
- Kodsuz, biçimsiz ve yanlış kodun reddi; doğru kodla `PIN` kanıtı ve teslimden sonra kodun gizlenmesi.
- Kodsuz eski siparişin kurye tarafından teslimi.
- Aynı anda sekiz yanlış tahminden yalnızca beşinin sayılması; kilitten sonra doğru kodun reddi; personelin `STAFF` kanıtıyla teslimi.
