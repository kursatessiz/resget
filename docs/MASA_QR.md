# Masa QR: müşteri edinme yüzeyi

Kapıdaki sticker pasiftir. Masadaki QR, müşterinin zaten telefonuyla taradığı şeydir; menüyü açan müşteri aynı anda platformu görür ve bir sonraki eve siparişinde restoranı burada bulur. Bu nedenle müşteri edinme kanalı reklam değil, restoranın kendi masasıdır.

## Akış

1. Restoran panelde (`/panel/<slug>/masalar`) masa oluşturur; her masanın benzersiz `qrToken`'ı vardır (16 rastgele bayt, base64url). Etiket üç biçimde alınır: `GET /restaurants/:id/tables/:tableId/label.svg` basılabilir etiket (işletme adı, QR, masa adı, işletmenin dilinde "Menü için okutun" yazısı; üst şerit işletmenin birincil rengindedir), `GET .../qr.png` yalnızca QR (1024 px, baskı atölyeleri için), `/panel/<slug>/masalar/yazdir` ise tüm aktif masaların etiketlerini tek sayfada gösterir ve tarayıcının yazdır penceresinden PDF kaydedilir. Etiket adı, QR ve yazı dışında hiçbir veri taşımaz; token yalnızca URL içinde yer alır.
2. Misafir tarar: `https://<web>/m/<token>`. Sayfa sunucuda `GET /public/qr/:token` ile menüyü çeker ve restoranın renginde render eder. Uygulama kurulumu, giriş veya telefon istenmez.
3. Sayfa üç çıkış sunar: masaya sipariş, bir dahaki sefere eve sipariş (`/<slug>`), telefon numarasıyla tek dokunuş kayıt.
4. Her adım anonim bir oturum kimliğiyle (`resget_qr_session` çerezi, web middleware'i ilk ziyarette açar; API'ye `x-qr-session` başlığıyla gider) `qr_scan_events` tablosuna yazılır: `VIEWED_MENU`, `STARTED_ORDER`, `PLACED_ORDER`, `REGISTERED` (sayfadaki "telefon numaranla kaydol" bağlantısı `/giris?kayit=1&masa=<token>`; doğrulamada `qrToken` ve oturum kimliği API'ye iletilir). Telefon numarası veya kimlik tutulmaz.

## Ölçüm

`computeQrFunnel()` (`packages/shared/src/table-qr.ts`) olayları oturum bazında sayar: beş kez yenileyen misafir tek izleyicidir; sonraki adım öncekileri ima eder. `GET /restaurants/:id/tables/funnel?from&to` restoran başına dönüşümü verir:

- menüyü gören
- sipariş başlatan
- sipariş veren
- kaydolan
- görüntülemeden siparişe ve kayda dönüşüm oranları

Bu sayı, Faz 0'da OARD ile birlikte izlenen iki ölçütten biridir (`docs/YOL_HARITASI.md`).

## Güvenlik

- Token bilinmedikçe sayfa açılmaz; sıralı kimlik yoktur.
- QR yenileme (`POST /restaurants/:id/tables/:tableId/regenerate`) eski etiketleri geçersiz kılar; panel uyarır. Pasife alınan masanın (`PATCH .../tables/:tableId`, `isActive: false`) QR'ı menüyü açmaz; masa silinmez, siparişler masaya bağlı kalır.
- Herkese açık uç oran sınırlı olmalıdır (A1 ile birlikte Redis tabanlı sınır eklenecek).
- Menü sayfası yalnızca restoranın yayınladığı veriyi gösterir; `isActive` olmayan masa veya restoran 404 döner (`TABLE_NOT_FOUND`).
