# Restorandan restorana tavsiye

Restoran, tanıdığı restoranları platforma davet eder. Davet bağlantısıyla kayıt olan restoran hemen ek PRO süresi alır; o restoran yeterince sipariş tamamladığında davet eden restorana da PRO süresi eklenir. Büyüme coğrafi yoğunlukla ilerlediği için (`docs/YOL_HARITASI.md`) en güçlü kanal, aynı ilçedeki restoranların birbirini getirmesidir.

Modül `partner_referrals` anahtarının arkasındadır (varsayılan kapalı, BETA). Anahtar davet eden restoran için açılır (genel veya işletme bazında). Programın kendisi ve ödül süreleri süper admin konsolundaki **Restoran tavsiyesi** sayfasından (`/admin/tavsiye`) yönetilir.

Müşteri tavsiyesi ayrı bir modüldür: `docs/TAVSIYE.md`.

## Ödül yalnızca PRO süresidir

Komisyon oranına, komisyon faturalarına ve hakediş hesabına dokunulmaz (`docs/MUTABAKAT.md`). Ödül, aboneliğe gün eklemektir ve hiçbir zaman aboneliği kısaltmaz (`proExtension()`, `packages/shared/src/partner-referrals.ts`):

| Abonelik durumu | Eklenen gün |
| --- | --- |
| PRO deneme sürüyor | Deneme bitişi ileri alınır. |
| PRO ödenmiş, gecikmede veya iptal edilmiş ama dönemi sürüyor | Dönem sonu ileri alınır; bir sonraki yenileme de o kadar kayar. |
| PRO ödenmiş ve dönem sonu yok (süresiz) | Değişiklik yok. |
| BASIC, ya da biten deneme veya dönem | Bugünden başlayan bir PRO denemesi açılır. |

## Akış

1. Restoran panelinde **Plan** sayfasındaki **Restoran davet et** kartından davet bağlantısını oluşturur (`subscription.manage` izni). Kod `P` ve 7 karakterdir (karışan 0/O, 1/I/L yok), restoran başına tektir; bağlantı `/kayit?davet=<kod>` biçimindedir.
2. Bağlantıyı açan kişi giriş yapmamışsa giriş sayfasına gider; davet kodu giriş sonrasına taşınır. Kayıt sayfası daveti gösterir: "<restoran> sizi davet etti: kayıt olunca N gün ek PRO kullanırsınız."
3. Kayıtta kod kontrol edilir. Program açık, kod geçerli, modül davet eden için açık ve yeni restoranın sahibi davet eden restoranın bir üyesi değilse iki restoran bağlanır (`partner_referrals`, `PENDING`) ve yeni restorana ek gün eklenir. Kullanılamayan kod (bilinmeyen, kapalı program, kendi kendine davet) sessizce yok sayılır; kayıt hiçbir zaman bu yüzden başarısız olmaz.
4. Yeni restoranın **nitelikli sipariş** sayısı eşiğe ulaştığında, o sipariş tamamlandıktan hemen sonra davet eden restorana ödül günleri eklenir (`REWARDED`). Nitelikli sipariş, tamamlanmış (`DELIVERED` veya `PICKED_UP`), müşterisi kayıtlı ve gerçekten bağımsız bir sipariştir: sipariş kaydında müşteri kullanıcısı (`customerUserId`) dolu olmalı, bu kullanıcı yeni restoranın veya davet eden restoranın herhangi bir durumdaki (`INVITED`, `ACTIVE`, `PASSIVE`) üyesi olmamalı ve her ayrı müşteri en fazla bir kez sayılır. Yani "ödül için gereken sipariş" ayarı fiilen "gereken ayrı dış müşteri sayısı" demektir; aynı kişinin tekrarlanan siparişi, personelin veya sahiplerin kendi siparişi ve müşterisiz (personelin girdiği) sipariş sayılmaz. Karttaki ve konsoldaki ilerleme (`completedOrders`) aynı ölçüyü gösterir. Davet edenin son 365 gündeki ödül sayısı yıllık sınıra ulaşmışsa ödül verilmez (`CAPPED`); yeni restoranın kayıt bonusu yine kalır. Yıllık sınırın nasıl korunduğu aşağıda, "Ödül adımı ve eşzamanlılık" bölümündedir.
5. Kart, davet edenin kazandığı toplam günü ve davetle gelen restoranları (kayıt tarihi, tamamlanan sipariş ilerlemesi, durum) gösterir.

## Ödül adımı ve eşzamanlılık

Ödül, siparişin durum değişikliğiyle aynı veritabanı işleminde verilmez. Sipariş `DELIVERED` veya `PICKED_UP` olarak kesinleştikten sonra ödül adımı kendi kısa işleminde çalışır (`OrdersService.afterTransitionCommitted`, `PartnerReferralsService.onOrderCompletedSafely`). Bu adımı sipariş durumunu değiştiren her yol çağırır: panelden durum değişikliği, kendi kurye seferinde teslim ve kurye ağının teslim bildirimi.

- **Yıllık sınır**: davet edenin son 365 gündeki ödül sayısı, o davet eden için alınan bir danışma kilidinin (`pg_advisory_xact_lock`, anahtar `partner-referral-cap:<restoran>`) altında sayılır. Aynı davet edenin birden çok restoranı aynı anda eşiği geçse bile `REWARDED` satırı sayısı sınırı aşmaz: sonradan gelen kilidi bekler, kesinleşmiş satırları görür. Kilit restoran satırına alınmaz; davet edenin kendi siparişleri ve restoran satırına bağlı yazımlar bu kilidi hiç beklemez.
- **Bir kez ödül**: davet, ödül verilmeden önce `PENDING` durumundan koşullu olarak alınır; eşiği aynı anda geçen iki sipariş aynı davet için ödülü iki kez vermez.
- **Sipariş hiçbir zaman bu yüzden başarısız olmaz**: ödül adımı hata fırlatmaz ve siparişin işlemini açık tutmaz. Kilit en fazla 2 saniye beklenir (`lock_timeout`); alınamazsa, veritabanı hatası olursa veya süreç sipariş kaydı ile ödül arasında durursa davet `PENDING` kalır.
- **Tarama**: `PartnerReferralsWatchdog` 10 dakikada bir, son 7 günde tamamlanmış siparişi olan `PENDING` davetleri (geçiş başına en fazla 200, en eskisi önce) yeniden değerlendirir ve eşiği geçenleri aynı adımla ödüllendirir veya sınıra takılmış olarak (`CAPPED`) kapatır. Testlerde ve `ORDER_WATCHDOG=off` iken kapalıdır.

Önceki sürümde sınır, sipariş işleminin içinde davet eden restoran satırına `SELECT ... FOR UPDATE` ile sayılıyordu. Aynı davet edenin restoranları aynı anda sipariş tamamladığında işlemler bu kilidi sırayla bekliyor, 5 saniyelik işlem süresini aşan sipariş durum değişikliği geri alınıyordu (HTTP 500); bu yüzden ödül adımı işlemin dışına alındı.

## Konsol ayarları

| Ayar | Varsayılan | Sınır |
| --- | --- | --- |
| Program açık | kapalı | |
| Davet edene verilen PRO günü | 30 | 0 ile 365 |
| Yeni restorana kayıtta verilen ek PRO günü | 30 | 0 ile 365 |
| Ödül için gereken tamamlanmış sipariş | 10 | 1 ile 1000 |
| Bir restoranın bir yılda alabileceği en fazla ödül | 12 | 1 ile 100 |

Değerler platform verisidir (`partner_referral_config`, tek satır) ve her değişiklik denetim kaydına yazılır. Ödül, verildiği andaki ayarla hesaplanır; kayıt bonusu kayıt anındaki ayarla verilir ve davet satırında saklanır. Konsol sayfası bütün davetleri ilerlemesi ve durumuyla listeler.

## Kötüye kullanıma karşı

- Kendi kendine davet: yeni restoranın sahibi davet eden restoranda herhangi bir üyelik taşıyorsa bağlantı kurulmaz.
- Yeni restoran, kullanıcının ilk restoranı değilse (`docs/PLATFORM_YONETIMI.md`, kayıt sınırları) bağlantı kurulur ama kayıt bonusu 0 gün yazılır; bonus gün PRO süresi olduğundan deneme gibi yalnızca ilk restorana verilir.
- Sahte müşteriyle ödül toplama: ödül yalnızca iki restoranın üyesi olmayan, birbirinden ayrı müşterilerin tamamlanmış siparişleriyle açılır (akış 4. madde). Kalan risk: herkese açık sipariş ucu doğrulanmamış bir telefon numarasıyla müşteri kullanıcısı oluşturabildiğinden, çok sayıda uydurma numara kullanan bir işletme bu ölçüyü yine de aşabilir; bunu yalnızca eşik, yıllık sınır ve konsoldaki davet listesinin gözden geçirilmesi sınırlar.
- Ödül sipariş tamamlanmasına bağlıdır, kayda değil; eşik ve yıllık sınır konsoldan sıkılaştırılabilir.
- Bir restoran yalnızca bir kez davet edilmiş olabilir (yeni restoran başına tek satır).
- Herkese açık davet ucu istemci başına oran sınırlıdır (10 dakikada 30 sorgu, `PUBLIC_INVITE_RATE_LIMIT`).

## API

| Uç | Erişim |
| --- | --- |
| `GET /restaurants/:id/partner-referrals` | `subscription.manage`, `@RequireFeature('partner_referrals')` |
| `POST /restaurants/:id/partner-referrals/code` | Aynı; program kapalıysa `REFERRAL_NOT_AVAILABLE` |
| `GET /public/partner-invites/:code` | Herkese açık, oran sınırlı; kullanılamayan kodda 404 |
| `GET` / `PUT /admin/partner-referrals/config` | Süper admin |
| `GET /admin/partner-referrals` | Süper admin; son 200 davet |
| `POST /restaurants` | Kayıt gövdesinde isteğe bağlı `partnerCode` |

Veri: `restaurants.partnerCode`, `partner_referral_config`, `partner_referrals`. Migration: `20261111000000_partner_referrals`.

## Sonraki adımlar

- Ödül verildiğinde davet edene bildirim.
- İlçe bazlı kampanya dönemleri (örneğin lansman haftasında daha yüksek ödül).
