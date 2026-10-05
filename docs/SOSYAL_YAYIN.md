# Sosyal yayın

İşletme bir gönderiyi bir kez yazar. Gönderi, seçtiği Facebook sayfalarında ve Instagram işletme hesaplarında hemen veya belirlediği zamanda yayımlanır. Bu, pazarlama yol haritasının 18. maddesinin son adımıdır (`docs/ENTEGRASYON_MERKEZI.md`).

Modül `social_publishing` anahtarının arkasındadır (varsayılan kapalı, BETA). Hesaplar entegrasyon merkezinde bağlandığı için `integration_hub` anahtarı da açık olmalıdır.

- Sözleşmeler: `packages/shared/src/social-publishing.ts`.
- API: `apps/api/src/modules/social-publishing`.

## Ekranlar

| Yer | Adres | Görüntüleme | Yazma |
| --- | --- | --- | --- |
| İşletme paneli | `/panel/<slug>/sosyal` | `campaigns.view` | `campaigns.manage` |
| Platform | `/pazarlama/sosyal` | `platform.marketing.view` | `platform.marketing.manage` |

## Gönderi

Bir gönderide şunlar bulunur:

- **Metin:** en çok 2.200 karakter. Bu, Instagram'ın sınırıdır; Facebook daha uzun metne izin verse de gönderi katı olan sınıra uyar.
- **Hesaplar:** en çok 10 hesap. Yalnızca bağlı, "Kullanılsın" ile açılmış ve etkin hesaplar seçilebilir; aksi halde `SOCIAL_ACCOUNT_UNAVAILABLE` döner.
- **Görsel:** isteğe bağlı. PNG, JPEG veya WebP, en çok 8 MB. Görselin türü dosya adından değil, baytlarından okunur.

Kurallar (`socialPostProblems()`; ekran da, API de aynı işlevi kullanır):

- Instagram hesabı seçilmişse görsel zorunludur (`INSTAGRAM_NEEDS_IMAGE`).
- Instagram en çok 30 etiket kabul eder (`TOO_MANY_HASHTAGS`).

Kurallara uymayan gönderi zamanlanamaz ve yayımlanamaz; bu durumda `SOCIAL_POST_INVALID` döner. Zamanlanmış bir gönderi düzenlenince veya görseli kaldırılınca kurallara artık uymuyorsa taslağa döner. Böylece yayın zamanı geldiğinde hata vermez.

## Durumlar

| Durum | Anlamı |
| --- | --- |
| `DRAFT` | Taslak |
| `SCHEDULED` | Yayın zamanını bekliyor, ya da reddedilen bir hesap yeniden denenecek |
| `PUBLISHING` | Bir yayın turu sürüyor |
| `PUBLISHED` | Bütün hesaplarda yayımlandı |
| `PARTIAL` | Bazı hesaplarda yayımlandı, bazılarında yayımlanamadı |
| `FAILED` | Hiçbir hesapta yayımlanamadı |

Her hesap, kendi sonucu olan bir hedeftir (`PENDING`, `PUBLISHED`, `FAILED`). Bir hesabın başarısız olması diğerlerini gizlemez. Hesap sonradan kaldırılsa bile adı ve türü hedefte kalır.

## Yayın turu

1. **Başlatma:** "Şimdi yayımla" turu istek içinde çalıştırır. Zamanlanmış gönderiyi `SocialPublishingWatchdog` dakikada bir yakalar.
2. **Kiralama:** tur, gönderiyi atomik olarak beş dakikalığına kiralar (`PUBLISHING`). Böylece istek ile tarama aynı gönderiyi iki kez yayımlamaz. Çökmüş bir turun kirası dolunca gönderi yeniden sıraya alınır.
3. **Gönderme:** bekleyen her hesap, kendi sayfa anahtarıyla Graph API'ye gönderilir:
   - **Facebook sayfası, görselsiz:** `POST /{page-id}/feed`.
   - **Facebook sayfası, görselli:** `POST /{page-id}/photos`. Sayfada görünen gönderinin kimliği saklanır.
   - **Instagram:** önce medya kabı (`POST /{ig-user-id}/media`), sonra yayım (`POST /{ig-user-id}/media_publish`).
4. **Yeniden deneme:** Meta'nın reddettiği hesap beş dakika sonra yeniden denenir. Üçüncü denemeden sonra `FAILED` olur. Kaldırılmış veya kapalı hesap (`ACCOUNT_UNAVAILABLE`) ve kapalı modül (`MODULE_OFF`) yeniden denenmez.
5. **Sonuç:** gönderinin durumu hedeflerinden çıkarılır. Yayımlanan hesaplar yayımlanmış kalır.

## Düzenleme ve silme

- **Düzenleme:** gönderi yalnızca hiçbir hesabı henüz denenmemişken düzenlenebilir, görsel alabilir, zamanlanabilir veya yayımlanabilir. Bir hesap denendikten sonra düzenlemek, değişmiş gönderiyi zaten yayımlanmış olanın yanına ikinci kez gönderirdi; bu yüzden gönderi kilitlenir (`SOCIAL_POST_LOCKED`).
- **Silme:** taslak, henüz denenmemiş zamanlanmış gönderi ve `FAILED` gönderi silinebilir. Yayımlanan gönderi kayıtta kalır, çünkü buradan silmek onu hesaplardan kaldırmaz.

## Görseller

Görseller logo gibi `UPLOADS_DIR` altında saklanır (`social/<restaurantId>/<rastgele ad>`). `GET /uploads/social/:restaurantId/:file` adresinden herkese açık sunulur, çünkü Meta Instagram için görseli bu adresten indirir.

- Adres yalnızca bir gönderi görsele işaret ettiği sürece yanıt verir; diskteki yol URL'den değil kayıttan kurulur.
- Görsel değiştirilince, kaldırılınca veya gönderi silinince dosya silinir.
- Canlıda `PUBLIC_API_URL` internetten erişilebilir olmalıdır.

## Denetim kaydı

`social.post.create`, `social.post.update`, `social.post.schedule`, `social.post.unschedule`, `social.post.publish`, `social.post.delete`.

## Sağlayıcı

`META_PROVIDER=MOCK` iken yayın taklit edilir: metninde `#fail` geçen gönderi Graph hatası gibi reddedilir, diğerleri kabul edilir. Canlı kullanım için `pages_manage_posts` ve `instagram_content_publish` izinleri App Review'dan geçmelidir (`docs/ENTEGRASYON_MERKEZI.md`).

## Sonraki adımlar

- **Dört göz onayı:** kampanyalardaki onay akışı (`docs/ONAYLAR.md`) gönderilere de uygulanabilir.
- **Yapay zeka:** yapay zeka stüdyosundan metin taslağı alınabilir (`docs/YAPAY_ZEKA.md`).
- **Çoklu görsel:** birden çok görsel (karusel) ve video desteklenebilir.

## Testler

- `packages/shared/src/social-publishing.spec.ts`:
  - Etiket sayımı.
  - Instagram kuralları.
  - Giriş şeması.
- `apps/api/src/modules/social/meta-graph.spec.ts`:
  - Sayfa akışı ve fotoğraf gönderisi.
  - Instagram medya kabı ve yayımı.
- `apps/api/test/e2e/social-publishing.e2e-spec.ts`:
  - Modül anahtarı ve yalnızca kullanımdaki hesaplar.
  - Instagram görsel kuralı, görsel yükleme ve sunumu.
  - Geçersiz zaman.
  - Zamanlanmış gönderinin taramada iki hesapta yayımlanması ve ikinci kez yayımlanmaması.
  - Yayımlanan gönderinin kilidi.
  - Kapalı hesapla kısmi yayın.
  - Reddedilen hesabın üç denemesi ve bu sırada kilit.
  - Başarısız gönderinin silinmesi.
  - Görselin yalnızca işaret edildiği sürece sunulması.
- `apps/web/e2e/social-publishing.e2e.ts`:
  - Gönderi yazma.
  - Instagram görsel uyarısı.
  - Sayfada hemen yayımlama ve listede sonucun görünmesi.
