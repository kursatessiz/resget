# Kişisel veri hakları (KVKK / GDPR)

Kişi platformun kendisi hakkında tuttuğu bilgiyi indirebilir ve hesabını kalıcı olarak silebilir. İkisi de web'de `/hesabim` sayfasında, silme ayrıca mobil uygulamanın Hesap sekmesindedir (mağaza kuralları uygulama içinden silmeyi şart koşar). Kurallar `packages/shared/src/privacy.ts`, uygulama `apps/api/src/modules/account/privacy.service.ts` içindedir.

## Verilerimi indir

`GET /me/data-export` (yalnızca oturum) tek bir JSON döner (`PersonalDataExportDTO`): profil (telefon, ad, e-posta, dil, kayıt tarihi), kayıtlı adresler, siparişler (restoran, durum, tutar, kalemler, adres, değerlendirme), restoranlardaki müşteri kayıtları (sipariş sayısı, pazarlama izni, sadakat puanı), personel üyelikleri, kabul edilen dokümanlar, kayıtlı kartların görünen kısmı (marka, son dört hane, son kullanma) ve bildirim cihazları. Dosya tarayıcıda oluşturulur (`personal-data.json`), sunucuda saklanmaz. Kart numarası platformda olmadığı için dosyada da yoktur.

## Hesabımı sil

`POST /me/account/delete` gövde `{ "confirm": true }` (yalnızca oturum, 204). Ekran açıklamayı gösterir ve onay kutusu işaretlenmeden düğmeyi açmaz; mobilde sistem onay penceresi çıkar.

Silmeyi engelleyen durumlar (409):

| Kod | Durum |
| --- | --- |
| `ACCOUNT_DELETE_OWNER` | Kişi etkin bir işletmenin sahibi. Önce işletme bir ekip üyesine devredilir (`docs/PERSONEL.md`, "Sahipliğin devri") veya platform ekibiyle kapatılır; sahipsiz işletme kalmaz. |
| `ACCOUNT_DELETE_SUPER_ADMIN` | Platform yöneticisi kendini buradan silemez. |
| `ACCOUNT_DELETE_ACTIVE_ORDERS` | Müşterinin devam eden siparişi var (ödeme bekleyen sipariş engel değildir). |
| `ACCOUNT_DELETE_ACTIVE_TRIP` | Kuryenin planlanmış, atanmış veya yoldaki seferi var. |

Silinenler (tek işlemde):

- Kayıtlı adresler, kayıtlı kartlar (kasa token'ı işlemden sonra kasaya da unutturulur; hata günlüğe yazılır, platformda token kalmaz), push cihazları, OTP kayıtları.
- Kurye konumu ve konum izi; personel üyelikleri `PASSIVE` olur ve kişi personel listelerinden çıkar.
- Her restorandaki müşteri kaydında pazarlama izni (vazgeçme zamanı yazılır, vazgeçme bağlantısı geçersiz olur), restoranın notu ve etiketleri, sadakat puanı (bakiye `ADJUSTMENT` satırıyla sıfırlanır). Sipariş sayısı ve ciro sayaçları restoranın raporları için kalır; kayıt müşteri listesinde artık görünmez.
- Siparişlerdeki müşteri notu ve teslimat adresinin kişiyi tanımlayan kısmı (sokak, kişi adı, telefon, konum); il ve ilçe raporlar için kalır. Değerlendirmelerde puan kalır, yorum silinir.
- Kişinin tavsiye kodu ve kullanılmamış ödül kuponları kapatılır (`docs/TAVSIYE.md`); kullanılmış kuponlar kayıt için kalır.
- Kullanıcı satırında ad, e-posta ve dil; telefon `deleted:<kullanıcı kimliği>` biçiminde bir mezar taşıyla değiştirilir ve `deletedAt` damgalanır.

Saklananlar ve gerekçesi:

- Siparişler, ödemeler, iadeler, defter satırları, komisyon faturaları ve mali belgeler: vergi ve ticaret mevzuatının saklama süresi boyunca (Türkiye'de en az 5 yıl, ülkeye göre değişir) tutulur. Bu kayıtlar kişiyle ilişkilendirilemez hale gelir: kullanıcı satırı anonim bir mezar taşıdır, ekranlar silinmiş hesabın adını ve telefonunu göstermez (`visibleContact`).
- Kabul edilen doküman kayıtları (`Consent`): onayın verildiğinin ispatı olarak saklanır ve anonim kullanıcıya bağlı kalır.
- Denetim kaydı: `account.deleted` satırı.

Sonrası:

- Eldeki erişim ve yenileme jetonları hemen geçersizdir: kimlik doğrulama ve yenileme `deletedAt` dolu kullanıcıyı reddeder.
- Telefon numarası serbest kalır; aynı numarayla yeniden giriş yeni ve boş bir hesap açar, eski siparişler ona bağlanmaz.
- Silme geri alınamaz.

## Restoran tarafı

Restoran, kendi müşteri listesinde silinmiş hesabı görmez ve kampanyalar ona ulaşmaz. Geçmiş siparişlerde müşteri adı ve telefonu boş görünür; tutarlar, kalemler ve il / ilçe kalır.

## Testler

Shared `privacy.spec.ts` (mezar taşı, görünür iletişim, adres anonimleştirme, onay şeması); API e2e `privacy.e2e-spec.ts` (dışa aktarma, açık sipariş ve sahip engeli, silme, eski oturumun reddi, silinen ve kalan alanlar, panelde görünüm, numaranın yeniden kullanımı); Playwright `account.e2e.ts` (indirme ve silme akışı).
