# İş modeli ve fizibilite sayıları

Bu doküman, ürün fikrinin dayandığı fizibilite konuşmasının (Ekim 2026) sonuçlarını ve alınan kararları özetler. Sayılar finansal model varsayımıdır; doğrulanmış sektör verisi değildir. Her sayı kaynağıyla birlikte verilir ve değiştiğinde burası güncellenir.

## 1. Tez

Türkiye'de restoranların dijital sipariş edinme maliyetini yapısal olarak düşüren, teslimat operasyonuna girmeyen, düşük take-rate ile ölçeklenen bağımsız bir sipariş ve ödeme ağı kuruyoruz. Rakiplerin kârını azaltmak hedef değil, modelin olası sonucudur.

Restorana verilen mesaj tek cümledir: "Sipariş başına platform komisyonumuz yüzde 1. Ödeme kuruluşunun kesintisi ayrıca ve gerçek oranıyla yansıtılır. Teslimatı siz yaparsınız, isterseniz anlaşmalı kurye ağından teklif alırsınız."

## 2. Çürütülen fikir: valör geliri

İlk fikir, komisyon almadan tahsilat ile restorana ödeme arasındaki sürede parayı fonlarda değerlendirerek kazanmaktı. Hesap ve hukuk aynı yöne işaret etti:

| Haftalık ödeme düzeni | Değer |
|---|---|
| Ortalama bekleme | 3,5 gün |
| Yıllık yüzde 40 basit getiriyle 1 milyon TL tahsilatta getiri | 3.836 TL |
| Aynı tahsilatta yüzde 2 kartlı ödeme maliyeti | 20.000 TL |
| Yüzde 2 maliyeti karşılamak için gereken bekleme | 18,3 gün |

6563 sayılı Kanun Ek 1. madde, pazaryerinin restorana ödemeyi en geç 5 iş günü içinde yapmasını düzenler; TCMB düzenlemesi koruma hesaplarının nemalandırılmasını ödeme kuruluşuna bırakır, pazaryerine değil. Bu nedenle valör geliri modelde yoktur. Ödeme kuruluşuyla bekleyen bakiyeden pay anlaşması yapılırsa bu ayrı bir gelir kalemi olur ve yazılı teyitle eklenir.

## 2a. Varsayılan tahsilat modeli: restoranın kendi POS'u

İkinci karar (Ekim 2026): restoran kendi sanal POS'unu platforma bağlar, para doğrudan restoranın hesabına gelir, platform komisyonunu ay sonunda fatura eder (`docs/ODEME.md`). Bu, Faz 0'ın en riskli iki kalemini (nakit döngüsü, chargeback) ve ödeme kuruluşu lisans konusunu modelden çıkarır; karşılığında komisyon tahsilat riskini platforma getirir (kayıtlı karttan otomatik çekim ve gecikmede listeleme askıya alma ile yönetilir). Platformun kendi PSP'si isteyen restoranlar için Faz 1'de açılır.

## 3. Birim ekonomisi

Varsayımlar: ortalama sepet 700 TL (2026 için model varsayımı; 2024 hızlı ticaret ortalaması 351 TL idi), komisyon yüzde 1, PSP maliyeti restorana yansıtılır, teslimat restoranda.

| Sipariş başına | Tutar |
|---|---|
| Platform geliri | 7 TL |
| Hedef değişken maliyet (bulut, API, SMS, destek, fraud payı) | 1 TL |
| Katkı marjı | 6 TL |

Katkı marjının 1 TL değişken maliyet hedefine bağlı olduğu, bu hedefin iddialı olduğu kabul edilmiştir. Mimari bu nedenle sipariş başına işlem maliyetini en başta düşük tutacak şekilde kurulur (sunucu tarafı render, az bildirim, OTP dışında SMS yok).

Hakediş motoru (`packages/shared/src/settlement.ts`) sipariş başına bu dağılımı üretir; `contributionPerOrder()` katkı marjını verir.

## 4. Ölçek senaryoları

Restoran başına günde 5 sipariş varsayımıyla:

| Restoran | Aylık sipariş | Aylık GMV | Yüzde 1 gelir / ay |
|---|---|---|---|
| 1.000 | 150.000 | 105 milyon TL | 1,05 milyon TL |
| 10.000 | 1,5 milyon | 1,05 milyar TL | 10,5 milyon TL |
| 50.000 | 7,5 milyon | 5,25 milyar TL | 52,5 milyon TL |

Konuşmanın sonucu: yüzde 1 tek başına düşük değil, düşük olan yeterli GMV oluşmadan yüzde 1. 1.000 restoranda zarar normaldir; 10.000 restoranda çekirdek operasyon (yaklaşık 7 milyon TL/ay) karşılanır ama büyüme pazarlaması zarar yazdırabilir; 50.000 restoranda model çalışır.

### Belirleyici değişken: OARD

Restoran sayısı değil, restoran başına günlük sipariş (Orders per Active Restaurant per Day) sonucu belirler. 50.000 restoranda:

| Günlük sipariş / restoran | Yüzde 1 gelir / ay |
|---|---|
| 1 | 10,5 milyon TL |
| 2 | 21 milyon TL |
| 5 | 52,5 milyon TL |
| 10 | 105 milyon TL |

Baz senaryo olarak 5 iyimser kabul edilir; uzun kuyruk restoranlarda gerçek değer çoğunlukla daha düşüktür. Faz 0'ın ilk işi bu sayıyı gerçek veriyle ölçmektir; planlama 2 ila 3 ile yapılır.

## 5. Gelir karması

Yüzde 1 tek gelir kaynağı değildir:

| Kaynak | Not |
|---|---|
| Pazaryeri komisyonu | Yüzde 1, GMV'ye bağlı |
| Restoran SaaS (PRO) | GMV'den bağımsız, gelir kalitesini artırır. 50.000 restoranın yüzde 20'si ayda 2.000 TL öderse 20 milyon TL/ay |
| Reklam ve öne çıkarma | Faz 1 sonrası |
| Mesaj kredileri | Maliyet artı; kâr merkezi değil |

## 6. Rekabet savunması

Yüzde 1 kopyalanabilir; rakip seçili restoranlarda komisyonu düşürebilir. Savunma ucuzluk değil, geçiş maliyetidir: restoranın müşteri listesi, menüsü, sadakat programı ve mesaj geçmişi platformdadır (`RestaurantCustomer`, SaaS katmanı). Yatırımcıya "büyümeye başlayınca durdurmak zor" cümlesinin ekonomik karşılığı budur.

## 7. Modelin bilinen zayıf noktaları

- Tüketici edinme planı sübvansiyon içermez; masa QR'ın dönüşümü ölçülmeden pazarlama bütçesi büyütülmez.
- Teslimatı restoran yapıyor varsayımı pazarı daraltır; kendi kuryesi olmayan restoranlar için Faz 2 kurye ağı entegrasyonu gerekir.
- Chargeback ve sahtecilik yükü yüzde 1 marjla ağırdır. Karar (4 Ekim 2026): iade ve chargeback maliyeti restoranla yapılan sözleşmede restorana yüklenir, platform komisyonu geri dönmez (`docs/MUTABAKAT.md`); PSP sözleşmesi bu akışı (chargeback bildirimi, ücret) karşılamalıdır.
- Her restoranın PSP alt üye işyeri KYC sürecinden geçmesi gerekir; onboarding süresi modele dahil edilmemiştir.
- 6563 sayılı Kanun'un belirli hacim eşiklerindeki ETHS yükümlülükleri büyüdükçe devreye girer.

## 8. Ödeme kuruluşu müzakere listesi

Teklif turunda her sağlayıcıdan aynı hacim eşikleri (250 bin, 1 milyon, 5 milyon, 10 milyon TL aylık kartlı tahsilat) için ertesi iş günü, 7 gün ve 14/15 gün seçenekleriyle istenecekler:

- BSMV dahil toplam kesinti
- İşlem başı, aylık ve restoran başı ücret
- İadede ilk tahsilat komisyonunun geri verilip verilmediği
- Restorana transfer ücreti ve sıklığı
- Ek bloke ve teminat kesintisi
- Kampanya sonrası oran ve hacim indiriminin başlangıcı
- Eşik geçildiğinde yeni oranın tüm aya mı, aşan tutara mı, sonraki aya mı uygulanacağı
- Valör, aktarım sıklığı ve restoran hakedişinin hangi andan itibaren sayıldığı

Hacim, uygulamadan geçen toplam kartlı ödemedir; tüm restoranların hacmi birlikte değerlendirilir.
