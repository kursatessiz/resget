# Vitrin: masa QR sayfası, restoran sayfası ve pazaryeri

Tüketici yüzeyi Faz 0'da web'dir ve uygulama kurulumu istemez (`HANDOVER.md`). Üç giriş vardır ve üçü de aynı sipariş oluşturma yolundan geçer (`OrdersService.create`): fiyat, ücret, hakediş anlık görüntüsü ve başlangıç durumu sunucuda belirlenir; tarayıcıdaki toplamlar yalnızca ön izlemedir.

## Sayfalar

- **Masa QR** (`/m/<token>`, `GET /public/qr/:token`): menü (görünür kategoriler, satıştaki seçenek grupları), masa, kabul edilen ödeme yöntemleri ve sipariş seçenekleri (`ordering`: masaya, gel al, eve teslim; ücret politikası; kurye ağından teklif alınıp alınmadığı). Sepete ilk ürün eklenince `POST /public/qr/:token/funnel` ile `STARTED_ORDER`, sipariş verilince `PLACED_ORDER` yazılır; anonim oturum `resget_qr_session` çerezidir ve BFF bunu `x-qr-session` başlığı olarak API'ye taşır (`docs/MASA_QR.md`).
- **Restoran sayfası** (`/<slug>`, `GET /public/restaurants/:slug/menu`): aynı menü ve sepet, masa seçeneği olmadan; eve teslim ve gel al. Uygulama yolları (`giris`, `kayit`, `panel`, `admin`, `m`, `t`, `j`, `pazaryeri` vb.) `RESERVED_SLUGS` ile slug olamaz.
- **Pazaryeri** (`/pazaryeri`, `GET /public/marketplace/areas` ve `GET /public/marketplace?countryCode&city&district`): açılmış hizmet alanlarından biri seçilir, o ilçede listelenen (`isListed`, `isActive`) restoranlar kart olarak gösterilir ve `/<slug>` sayfasına gider. Listeleme süper adminin kararıdır (`docs/PLATFORM_YONETIMI.md`).

## Sipariş verme

`POST /public/qr/:token/orders` ve `POST /public/restaurants/:slug/orders` gövdesi `PublicOrderSchema`: teslim şekli, satırlar (ürün, adet, seçilen seçenekler), iletişim (masa siparişinde isteğe bağlı, diğerlerinde zorunlu), adres (eve teslimde zorunlu), ödeme niyeti (`OrderPaymentIntentSchema`), not ve çevrim içi ödeme için dönüş adresi.

- Şube: masa QR'da masanın şubesi, restoran sayfasında ilk aktif şube (Faz 0 tek şube).
- Kanal: `TABLE_QR` veya `RESTAURANT_SITE`; masaya sipariş yalnızca QR'dan verilebilir.
- Teslimat ücreti: restoranın kuryesi varsa politika sıfır teklif üzerinden uygulanır (`PASS_THROUGH` ücretsiz, `FIXED` sabit, `FREE_ABOVE` eşik); kurye ağı kullanılıyorsa `CourierService.quoteFor()` teklifi politikadan geçer (`docs/KURYE.md`); şube veya adres koordinatsızsa ağ teklif veremez ve politika sıfır teklif üzerinden uygulanır. Ücret siparişte ayrı satırdır, komisyona girmez.
- Ödeme: niyet restoranın kabul ettiği yöntemlere göre çözülür (`docs/YEMEK_KARTI.md`). Çevrim içi yöntemlerde sipariş `PENDING_PAYMENT` açılır ve yanıt `checkoutUrl` taşır; tarayıcı barındırılan ödeme sayfasına gider, ödeme bildirimi siparişi `PLACED` yapar. Kapıda yöntemlerde sipariş hemen `PLACED` olur ve yanıt takip anahtarını döner; sayfa `/t/<token>` adresine geçer.
- Müşteri: telefonu verilen misafir global `User` olarak bulunur veya açılır ve restoranın müşteri listesine girer; mesaj bildirimleri `docs/MESAJLASMA.md` kurallarıyla gider.

## Oran sınırı

Kimliksiz yazma uçları `PublicRateLimitGuard` ile istemci başına sınırlıdır: sipariş `PUBLIC_ORDER_RATE_LIMIT` (varsayılan 10) ve huni adımı `PUBLIC_FUNNEL_RATE_LIMIT` (varsayılan 60), 10 dakikalık pencerede. Sayaç Redis varsa orada (her API örneği aynı pencereyi görür), yoksa süreç belleğindedir. İstemci, Caddy'nin ilettiği ilk `x-forwarded-for` adresi veya soket adresidir. Aşım `RATE_LIMITED` ile reddedilir.

## Henüz yok

Adres geokodlama (koordinat olmadan kurye ağı teklifi alınamaz; kendi kurye sevkinde durak rotalanmaz), müşteri hesabına kayıtlı adresler (`customer_addresses`), kayıtlı kartla tek dokunuş ödeme, sipariş sonrası değerlendirme. Mobil uygulama Faz 1'dir.
