# Müşteri tavsiyesi

Restoranın müşterisi kişisel kodunu paylaşır. Restorandan hiç sipariş vermemiş bir arkadaş ilk siparişinde indirim alır; o sipariş tamamlanınca davet eden müşteriye yalnızca onun kullanabileceği bir ödül kuponu verilir. İndirim de ödül de restoranın karşıladığı kuponlardır (`docs/KUPONLAR.md`), bu yüzden kuponların bütün kuralları geçerlidir.

Modül `referrals` anahtarının arkasındadır (varsayılan kapalı, BETA). Kuponlar modülü (`coupons`) açık ve plan PRO olmalıdır; plan BASIC'e düşünce kişisel kodlar ve ödüller kullanılamaz (kuponlarla aynı kural).

Restorandan restorana tavsiye ayrı bir modüldür: `docs/RESTORAN_TAVSIYE.md`.

## Program

Panelde **Kuponlar** sayfasının altındaki **Tavsiye programı** kartı (`campaigns.view` görür, `campaigns.manage` ve PRO kaydeder):

| Alan | Kural |
| --- | --- |
| Program açık | Kapalıyken kişisel kodlar bilinmeyen kod gibi davranır ve müşteri hesabında program görünmez. Verilmiş ödüller geçerli kalır. |
| Arkadaşın indirimi | Yüzde (isteğe bağlı üst sınır) veya tutar; en az sepet tutarı. |
| Ödül | Davet edene verilen tutar kuponu ve geçerlilik süresi (7 ile 365 gün). |
| Sınır | Bir müşterinin son 30 günde alabileceği en fazla ödül (1 ile 100). Sınır aşılınca arkadaş indirimini yine alır, davet edene bu sipariş için ödül verilmez (`SKIPPED_CAP`). |

Program değişince yeni koşullar bütün kişisel kodlara hemen uygulanır; müşteri her zaman tek bir teklif görür. Kart ayrıca sonuçları gösterir: paylaşılan kod, kodla verilen ilk sipariş ve indirim toplamı, verilen ve kullanılan ödül, sınır yüzünden ödülsüz kalanlar.

## Kişisel kod

- Müşteri hesabında (`/hesabim`) **Arkadaşını davet et** kartı, programı açık olan ve kişinin en az bir sipariş verdiği her restoranı listeler. Hiç yoksa kart görünmez.
- **Kodumu al** kodu ilk istekte üretir (`R` ve 7 karakter; karışan 0/O, 1/I/L harfleri yoktur). Müşteri başına tek koddur.
- Paylaşım bağlantısı `/<restoran>?kod=<kod>` biçimindedir; arkadaş bağlantıyı açınca kod sepetteki kupon alanına yazılmış gelir. İndirim kodun uygulanmasıyla ve siparişte doğrulanır.
- Kod, kuponların kurallarıyla kullanılır: yalnızca restorandan ilk kez sipariş veren telefon, bir kez (`COUPON_FIRST_ORDER_ONLY`, `COUPON_ALREADY_USED`). Müşteri kendi kodunu kullanamaz (`COUPON_OWN_REFERRAL`). Sadakat puanıyla birleşmez.
- Kişisel kodlar panelin kupon listesinde görünmez; durdurulamaz veya silinemez, programla yönetilir.

## Ödül

- Arkadaşın siparişi tamamlandığında (`DELIVERED` veya `PICKED_UP`), aynı işlemde davet edene `W` ile başlayan bir tutar kuponu üretilir: tek kullanım, en az sepet yok, programdaki süre kadar geçerli. Kayıt `referral_rewards` tablosuna yazılır; sipariş başına bir kez.
- Ödül kuponu yalnızca sahibinin telefonuyla kullanılır; başkası için bilinmeyen koddur (`COUPON_NOT_FOUND`).
- Sipariş reddedilir veya iptal edilirse kodun kullanımı geri verilir ve ödül doğmaz. Tamamlanmış sipariş sonradan iade edilirse verilmiş ödül geri alınmaz.
- Program sonradan durdurulsa da, kod açıkken verilmiş siparişin ödülü verilir.
- Müşteri ödüllerini hesabındaki kartta görür: kod, tutar, son gün veya "Kullanıldı".

## Gizlilik ve hesap silme

Kişisel kodda ve ödülde kişisel veri yoktur; bağlantı yalnızca restoranın müşteri kaydınadır. Hesap silinince kişinin kodu ve kullanılmamış ödülleri kapatılır; kullanılmış kuponlar kayıt için kalır (`docs/KISISEL_VERI.md`).

## API

| Uç | İzin |
| --- | --- |
| `GET /restaurants/:id/referrals/program` | `campaigns.view`; `{ program }` (henüz yoksa `null`) |
| `PUT /restaurants/:id/referrals/program` | `campaigns.manage`, PRO |
| `GET /me/referrals` | Oturum açmış müşteri |
| `POST /me/referrals/:restaurantId/code` | Oturum açmış müşteri; kodu üretir veya mevcut olanı döner (`REFERRAL_NOT_AVAILABLE`) |

Veri: `referral_programs`, `referral_rewards`; `coupons` satırına `source` (`MANUAL` / `REFERRAL` / `REFERRAL_REWARD`), `referrerCustomerId` ve `ownerCustomerId` eklendi. Migration: `20261110000000_customer_referrals`.

## Sonraki adımlar

- Ödül olarak sadakat puanı seçeneği.
- Ödül verildiğinde müşteriye bildirim (push).
