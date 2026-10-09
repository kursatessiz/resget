# Güvenlik denetimleri

Platformun kimlik doğrulama ve dış dünyaya açık yüzeyindeki denetimleri tek yerde toplar. Modüle özgü ayrıntı ilgili belgededir; burada yalnızca kurallar ve nerede uygulandıkları vardır.

## Giriş kodu (OTP)

- Kod 5 dakika geçerlidir ve tek kullanımlıktır. Aynı telefona 5 dakikada en çok 3 kod istenir (`OtpService`).
- Bir kod için en çok 5 deneme yapılır. Deneme, kod karşılaştırılmadan önce koşullu artırılarak ayrılır; aynı anda gönderilen tahminler sınırı aşamaz. Doğru kod da yalnızca bir kez oturum açar: aynı anda iki doğru doğrulamadan biri kazanır.
- İstemci adresi başına kod isteği ve doğrulama 10 dakikada `PUBLIC_OTP_RATE_LIMIT` (varsayılan 30) ile sınırlıdır; tek bir adres çok sayıda telefona kod gönderemez veya deneme yapamaz.

## İstemci adresi

Hız sınırları istemci adresini Express'in `trust proxy` ile çıkardığı değerden alır (`request.ip`): Caddy'nin eklediği adres. İstemcinin kendi gönderdiği `X-Forwarded-For` değeri sınırı aşmak için kullanılamaz. Web BFF gelen başlığı olduğu gibi API'ye iletir; API önünde tek vekil olarak Caddy güvenilir.

## Yönlendirme hedefleri

Girişten sonra (`/giris?next=`) ve çıkıştan sonra gidilecek adres yalnızca bu sitedeki bir yoldur (`safeLocalPath`, `packages/shared/src/safe-path.ts`). `//alan`, `/\alan`, şema içeren adres ve sekme veya satır sonu gibi denetim karakterleri reddedilir.

## Dışarıya giden istekler

- Restoranın webhook adresi üretimde herkese açık bir `https` adresi olmalıdır; iç adlar ve özel adresler reddedilir, ad her gönderimden önce yeniden çözülür (`apps/api/src/common/net/public-address.ts`, `docs/API_ERISIMI.md`).
- Restoranın iyzico bilgileri yalnızca iyzico'nun canlı ve test adreslerine gönderilir (`IYZICO_BASE_URLS`); ödeme sağlayıcısı isteklerinde yönlendirme izlenmez.

## Yetkiler

- Bir yönetici kendinde olmayan yetkiyi veremez, kendi rolünü ve üyeliğini değiştiremez (`ROLE_ESCALATION`, `docs/PERSONEL.md`).
- API anahtarı oluşturanın o anki erişimiyle sınırlıdır; oluşturan ayrılınca anahtar çalışmaz (`docs/API_ERISIMI.md`).
- Kendi alan adı, platforma yönlendirilmiş olmanın yanında restorana özgü TXT kaydıyla kanıtlanır (`docs/VITRIN.md`).

## İstek boyutu

Caddy her sitede gövdeyi 10 MB ile sınırlar (en büyük yükleme 8 MB'lık sosyal gönderi görselidir). Web BFF aynı sınırı gövdeyi belleğe almadan önce `Content-Length` ile ve okuduktan sonra uygular (`PAYLOAD_TOO_LARGE`). API JSON gövdesi 1 MB ile sınırlıdır.
