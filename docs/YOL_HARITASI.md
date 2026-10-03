# Yol haritası

Büyüme coğrafi yoğunlukla ilerler. Hiperlokal pazaryerinde likidite mahalle seviyesindedir; Türkiye geneline dağılmış 500 restoran, tek ilçede toplanmış 50 restorandan daha az değerlidir.

## Faz 0: tek ilçe

Hedef: bir ilçede 30 ila 50 restoran, masa QR menü, kendi sipariş sayfası, yüzde 1 pazaryeri. Tahsilat restoranın kendi sanal POS'u ile (`OWN_POS`), kart kasası Masterpass veya bex; platform parayı hiç tutmaz (`docs/ODEME.md`).

Ürün: `HANDOVER.md` A1 ila A10. Sipariş durum makinesi, restoranın kendi kuryesi için sevk ve çok duraklı rota, canlı takip (`docs/SIPARIS_VE_SEVK.md`) çekirdektedir; kuryesi olan restoran ilk günden müşterisine canlı takip verir.

Dağıtım: masaya QR etiketi (aktif yüzey), kapıya sticker (pasif), seçili platformlarda uygulama paylaşımı, çok küçük reklam bütçesi. Bedava araç PRO denemesidir; BASIC zaten süresiz ücretsizdir.

İzlenen iki sayı:
- Restoran başına günlük sipariş (OARD)
- QR taramasından siparişe ve kayda dönüşüm (`GET /restaurants/:id/tables/funnel`)

Çıkış kriteri: OARD 2'yi geçince komşu ilçeye genişleme.

## Faz 1: genişleme

- Komşu ilçeler, lansman bayrağıyla (`ServiceArea.isLaunched`); hangi ilçenin sırada olduğunu konsolun lansman araçları gösterir: hazır restoran / hedef, OARD, pazaryerinde ilçeyi isteyen ziyaretçi sayısı ve alanı olmayan aday ilçeler (`docs/PLATFORM_YONETIMI.md`). Pazaryeri sıralaması açık olana, puana ve son siparişlere göredir (`docs/VITRIN.md`).
- Expo uygulaması: tek uygulama, rol üyelikten gelir (müşteri takip ve tekrar sipariş, kurye modu ile sefer ve arka plan konum, restoran tablet sevk panosu). QR taraması web'de kalır.
- PRO katmanı açılır: CRM, kampanyalar, sadakat, analitik, kendi alan adı.
- `PLATFORM_PSP` modu: platformun pazaryeri PSP ürünü, hakediş ödemeleri, PSP token kasası.
- Reklam ve öne çıkarma geliri.

## Faz 2: kurye

- Kendi kuryesi olmayan restoran sayısı anlamlı eşiği geçince anlaşmalı kurye ağı adaptörleri (ülkeye göre).
- Kurye her zaman ayrı fiyatlanan hizmet; müşteriye veya restorana açıkça yansır; yüzde 1'in içine girmez.
- Mahalle kurye havuzu, hukuki görüş (İŞKUR özel istihdam bürosu kapsamı) netleştikten sonra değerlendirilir. Kurye ilan panosu aynı görüşe bağlıdır.

## Geçiş eşikleri neden sayıya bağlı

5 yıllık finansal model, OARD ve QR dönüşümü gerçek veriyle ölçülmeden anlamsızdır. Faz 0'ın amacı para kazanmak değil, bu iki sayıyı öğrenmektir.
