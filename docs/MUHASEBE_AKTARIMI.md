# Muhasebe dökümü

Restoran, bir ayın siparişlerini muhasebecisi için CSV olarak indirir. Gerçek şirket verisiyle çalışırken resmi defterin ve beyanın girdisidir. Modül `accounting_export` anahtarının arkasındadır (varsayılan kapalı, BETA). Plan sınırı yoktur: dökümü almak işletmeyi yürütmek için gereklidir, bu yüzden `BASIC` restoran da kullanır.

## İlke

- **Hiçbir şey yeniden hesaplanmaz.** Dosyadaki her tutar siparişin üzerinde zaten duran anlık görüntüdür: yerleştirme anındaki `computeOrderSettlement()` sonucu ve kayıtlı iadeler. Bu yüzden dosya panelle, defterle ve komisyon faturasıyla her zaman aynı rakamı verir.
- **Dönem:** UTC takvim ayıdır; komisyon faturasının ayıyla aynıdır (`commissionPeriod()`). Yerel saatle ayın ilk günü gece yarısından sonra verilen bir sipariş, UTC'de önceki aya düşebilir. Dosyada hem UTC zamanı hem restoranın saat dilimindeki yerel zaman vardır.
- **Kapsam:** ödemesi tamamlanmamış çevrim içi siparişler (`PENDING_PAYMENT`) hiç gerçekleşmemiştir ve dosyada yer almaz. Diğer bütün siparişler durumlarıyla listelenir. Muhasebeci iptal, ret ve iadeleri ödeme sağlayıcısının raporuyla eşleştirebilir.

## Dosyalar

- **Uçlar:** iki uç vardır (`finance.view`):
  - `GET /restaurants/:id/accounting/orders.csv?year=&month=`
  - `GET /restaurants/:id/accounting/lines.csv?year=&month=`
- **Dosya adı:** `resget-orders-2026-10.csv` gibi.

**Siparişler** (`ACCOUNTING_ORDER_COLUMNS`), sipariş başına bir satır:
- **Kimlik:** sipariş kodu ve kimliği.
- **Zaman:** verilme zamanı (UTC ve yerel), tamamlanma zamanı (yerel).
- **Sipariş:** durum, kanal, teslim şekli.
- **Ödeme:** ödeme yöntemi, yemek kartı kuruluşu, ödeme modu (`OWN_POS` / `PLATFORM_PSP`), para birimi.
- **Tutarlar:**
  - ürünler brüt, KDV ve net;
  - teslimat ücreti;
  - indirim ve indirimi kimin karşıladığı;
  - müşteriden alınan tutar;
  - iade edilen toplam.
- **Platform ve kesintiler:**
  - komisyon oranı (yüzde), komisyon ve komisyon KDV'si;
  - PSP kesintisi ve kimin karşıladığı;
  - tevkifat;
  - kurye maliyeti ve kimin karşıladığı;
  - restoran hakedişi;
  - platform alacağı (`OWN_POS`'ta komisyon ve KDV'si).

**Kalemler** (`ACCOUNTING_LINE_COLUMNS`), satır başına bir satır:
- sipariş kodu, yerel zaman, durum;
- ürün adı, seçenekler, adet;
- birim fiyat, KDV oranı (yüzde), satır toplamı, para birimi.

KDV oranına göre toplamı muhasebeci bu dosyadan alır.

## Biçim

- **Tutarlar:** ana birimde düz ondalık metindir (`1234.50`). Para biriminin kuruş basamağına göre yazılır, kayan nokta kullanılmaz (`majorAmountText()`).
- **Tarihler:** UTC zamanı ISO biçimindedir; yerel zaman `YYYY-MM-DD HH:mm` biçimindedir. İkisi de dilden bağımsızdır.
- **Satırlar:** UTF-8 bayt sıra işaretiyle (BOM) başlar, satır sonları CRLF'tir.
- **Formül koruması:** formül karakteriyle başlayan kiracı metni (ürün adı gibi) etkisizleştirilir. Tutarlar dokunulmadan kalır, eksi işaretli değer bozulmaz (`accountingCell()`).

## Panel

Finans ekranında (`/panel/<slug>/finans`) "Muhasebe dökümü" kartı vardır:
- ay seçici (varsayılan olarak geçen ay);
- iki indirme düğmesi.

Kart yalnızca modül açıkken ve `finance.view` izniyle görünür.

## Testler

- `packages/shared/src/accounting.spec.ts`:
  - Dönem doğrulaması.
  - Hücre ve formül koruması.
  - Yüzde biçimi, yerel zaman, dosya adı ve BOM.
- `apps/api/test/e2e/accounting.e2e-spec.ts`:
  - Modül ve izin kapısı.
  - Geçersiz ay.
  - Sipariş satırında kayıtlı tutarlar.
  - Kalem dosyası.
  - Ödeme bekleyen siparişin ve başka ayın dışarıda kalması.
- `apps/web/e2e/accounting.e2e.ts`:
  - Finans ekranında kart ve CSV indirmesi.
