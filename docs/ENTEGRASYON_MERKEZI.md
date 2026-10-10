# Entegrasyon merkezi

Dış hizmetlere bağlantıların toplandığı yer. Yol haritasının 18. maddesi üç adımda gelir:

1. **Meta hesap bağlama (bu adım):** Facebook sayfaları ve onlara bağlı Instagram işletme hesapları OAuth ile bağlanır.
2. **Lead Ads:** Meta reklam formlarından gelen adaylar CRM kişisine dönüşür (`docs/LEAD_ADS.md`, anahtar `lead_ads`).
3. **Sosyal yayın:** bağlı hesaplara gönderi hazırlanır, zamanlanır ve yayımlanır (`docs/SOSYAL_YAYIN.md`, anahtar `social_publishing`).

Modül `integration_hub` anahtarının arkasındadır (varsayılan kapalı, BETA). Sözleşmeler `packages/shared/src/social.ts`, API `apps/api/src/modules/social` içindedir.

## Neden OAuth

Kullanıcı hiçbir zaman erişim anahtarı kopyalayıp yapıştırmaz. İşletme Meta'nın onay ekranına gönderilir, hangi sayfalara izin verdiğini orada seçer ve geri döner. Böylece:

- Anahtar ekranda veya tarayıcıda hiç görünmez.
- İzin kapsamı Meta'da görünür ve oradan geri alınabilir.
- Uzun süreli kullanıcı anahtarından alınan sayfa anahtarları süresiz geçerlidir; bağlantı yenileme gerektirmez.

## Akış

1. Panelde **Entegrasyon** sayfası (`/panel/<slug>/entegrasyon`) veya platform için **Pazarlama > Entegrasyonlar** (`/pazarlama/entegrasyonlar`) açılır. "Meta ile bağlan" düğmesine basılır.
2. `POST /restaurants/:id/social/meta/connect { returnPath }` (`integrations.manage`) bir onay turu başlatır:
   - 32 baytlık rastgele bir `state` üretir ve kiracıya, kullanıcıya ve geri dönüş ekranına bağlı olarak `oauth_states` tablosuna yazar.
   - `state` 10 dakika geçerlidir.
   - Meta onay adresini döner; tarayıcı oraya gider.
3. Meta tarayıcıyı web uygulamasının `GET /api/oauth/meta/callback?code&state` rotasına geri yollar (`META_OAUTH_CALLBACK_PATH`). Rota, sorguyu o tarayıcının oturum çereziyle birlikte `POST /oauth/meta/callback { state, code | error }` ucuna iletir. Uç oturum ister (API anahtarı kabul edilmez) ve oran sınırlıdır (10 dakikada 30 istek).
   - **Başlatanın oturumu:** state yalnızca onu başlatan kullanıcının oturumuyla talep edilir. Onay bağlantısı başka birine iletilip onun tarayıcısında tamamlanırsa (başka oturum veya oturum yok) hiçbir şey yazılmaz, state olduğu gibi kalır ve tarayıcı `/panel?meta=error` adresine gider.
   - **State:** atomik olarak bir kez talep edilir. Bilinmeyen, süresi geçmiş veya daha önce kullanılmış state reddedilir. Eksik veya tekrarlanan sorgu değeri yok sayılır.
   - **Anahtar:** kod kısa süreli anahtara, o da uzun süreli kullanıcı anahtarına çevrilir.
   - **Hesaplar:** kullanıcının yönettiği sayfalar ve bağlı Instagram işletme hesapları okunur.
   - **Kayıt:** her hesap `social_accounts` tablosuna yazılır (kiracı, sağlayıcı ve dış kimlik başına tek satır). Yeniden bağlanınca aynı satırlar güncellenir.
   - **Yönlendirme:** tarayıcı uygulamanın kendi ekranına `?meta=connected`, `denied` veya `error` ile döner.
4. Yeni bağlanan hesaplar kapalı gelir. İşletme, Lead Ads ve yayın için kullanılacak hesapları "Kullanılsın" kutusuyla seçer, istediğini "Bağlantıyı kaldır" ile siler.

## Güvenlik

- **Açık yönlendirme yok:** geri dönüş ekranı başlangıçta doğrulanır (yalnızca `/panel/<slug>/entegrasyon` veya `/pazarlama/entegrasyonlar`) ve dönüşte yeniden denetlenir. Tarayıcı yalnızca `PUBLIC_APP_URL` altına döner.
- **Tek kullanımlık state:** state kiracıya ve başlatan kullanıcıya bağlıdır, tek kullanımlıktır ve kısa ömürlüdür. Bir gün geçmiş turlar yeni tur başlarken silinir.
- **Tarayıcıya bağlı dönüş:** dönüş adresi API değil web uygulamasıdır; tur yalnızca başlatan kişinin oturumu olan tarayıcıda tamamlanır. Böylece başka bir sayfa yöneticisine iletilen onay bağlantısı onun hesaplarını başlatanın işletmesine bağlayamaz.
- **Eski dönüş adresi:** `GET /public/oauth/meta/callback` bir sürüm boyunca yalnızca hata ekranına (`/panel?meta=error`) yönlendirir, hiçbir turu tamamlamaz; sonraki sürümde kaldırılabilir.
- **Şifreli anahtar:** sayfa anahtarları `CredentialCipher` (AES-256-GCM, anahtar sürümlü) ile şifrelenir. Hiçbir yanıtta ve günlükte yer almaz; yalnızca Lead Ads ve yayın modülleri sunucu içinde çözer.
- **Modül kapalıyken:** dönüş hata ile sonuçlanır.
- **Denetim kaydı:** bağlama (`social.connect`), açma ve kapama (`social.enable`, `social.disable`) ve kaldırma (`social.disconnect`).

## İstenen Meta izinleri

`pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_posts`, `leads_retrieval`, `instagram_basic`, `instagram_content_publish`, `business_management` (`META_OAUTH_SCOPES`).

Canlı kullanım için Meta App Review'da her izin ayrı ayrı onaylanmalıdır. Onay haftalar sürebilir; başvuru erken yapılmalıdır (`docs/PAZARLAMA.md`).

## Sağlayıcı

`META_PROVIDER` ile seçilir:

| Değer | Davranış |
| --- | --- |
| `NONE` (varsayılan) | Bağlama kapalı (`SOCIAL_NOT_CONFIGURED`) |
| `MOCK` | Onay ekranı yerine tarayıcı doğrudan geri döner; bir sayfa ve bir Instagram hesabı bağlanır. Üretimde reddedilir |
| `LIVE` | Meta Graph API (`META_APP_ID`, `META_APP_SECRET` zorunlu, `META_GRAPH_VERSION` varsayılan `v21.0`) |

Meta uygulamasında geçerli OAuth yönlendirme adresi olarak `<PUBLIC_APP_URL>/api/oauth/meta/callback` tanımlanmalıdır (örneğin `https://resget.com/api/oauth/meta/callback`). Önceki sürümlerin `<PUBLIC_API_URL>/public/oauth/meta/callback` adresi artık turu tamamlamaz; dağıtımdan önce yeni adres eklenmeli, eski adres bir sürüm sonra listeden çıkarılabilir. Ortam değişkeni değişmez: adres `PUBLIC_APP_URL` üzerinden kurulur.

## Testler

- `apps/api/src/modules/social/meta-graph.spec.ts`: onay adresi (uygulama, state, geri dönüş, izinler), kodun uzun süreli anahtara çevrilmesi, sayfalar ve Instagram hesapları (sayfalama dahil), Graph hatası.
- `apps/api/test/e2e/integration-hub.e2e-spec.ts`: modül anahtarı, oturumsuz veya başka bir kullanıcının oturumuyla tamamlanan turun hiçbir şey yazmaması (eski herkese açık dönüş adresi dahil), dış adrese geri dönüşün reddi, onay turu, şifreli anahtar ve yanıtta anahtar olmaması, state'in ikinci kez kullanılamaması, yeniden bağlanmada aynı satırlar, bilinmeyen, süresi geçmiş ve reddedilmiş turlar, açma ve kaldırma, denetim kaydı.
- `apps/web/src/app/api/oauth/meta/callback/route.spec.ts`: dönüş rotasının sorguyu oturum çereziyle iletmesi, oturumsuz tarayıcıda hiçbir şey tamamlamaması, tekrarlanan veya eksik state, uygulama dışına işaret eden yanıtın reddi.
- `apps/web/e2e/integration-hub.e2e.ts`: tarayıcının MOCK onay turundan geçip ekrana dönmesi, hesapların listelenmesi ve seçilmesi.
