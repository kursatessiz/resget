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
4. Yeni restoran **tamamlanmış** sipariş sayısı (`DELIVERED` veya `PICKED_UP`) eşiğe ulaştığında, o siparişi tamamlayan işlemde davet eden restorana ödül günleri eklenir (`REWARDED`). Davet edenin son 365 gündeki ödül sayısı yıllık sınıra ulaşmışsa ödül verilmez (`CAPPED`); yeni restoranın kayıt bonusu yine kalır. Davet, ödül verilmeden önce `PENDING` durumundan koşullu olarak alınır; eşiği aynı anda geçen iki sipariş ödülü iki kez vermez.
5. Kart, davet edenin kazandığı toplam günü ve davetle gelen restoranları (kayıt tarihi, tamamlanan sipariş ilerlemesi, durum) gösterir.

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
