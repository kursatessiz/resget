# Güvenlik denetimi geçmişi

Bu belge, Cloudflare `security-audit` becerisiyle yapılan iki kaynak kodu denetiminin kalıcı özetidir: neyin tarandığı, ne bulunduğu, hangi PR'ın neyi kapattığı ve neyin açık kaldığı. Denetimlerin ara dosyaları (kapsam defteri, `findings.json`, ajan çıktıları) oturum ortamında üretildi ve ortamla birlikte silindi; bu belge onların yerini tutar. Kayıt parmak izleri (fingerprint) denetim kayıtlarındaki İngilizce halleriyle bırakıldı, böylece bir sonraki denetim aynı bulguyu eşleştirebilir.

Platformun kalıcı güvenlik kuralları `docs/GUVENLIK.md` içindedir; bu belge yalnızca denetim geçmişidir.

## Yöntem

- Profil `standard`, çalıştırma politikası `sandboxed-source-and-local-only`. Oturum ortamında işletim sistemi düzeyinde sandbox kurulamadı, bu yüzden hedef kod denetim sırasında hiç çalıştırılmadı ve hiçbir canlı sisteme istek gönderilmedi; tüm denetim kontrolleri salt kaynak okumasıdır.
- Sonuç olarak denetim hiçbir bulguyu `confirmed` olarak işaretleyemedi; her aday `needs_validation` (doğrulama bekleyen ipucu) ya da `rejected` oldu. Her aday iki ayrı doğrulayıcıdan geçti (Faz 3 bağımsız yeniden okuma, Faz 5 son kayıt denetimi).
- Düzeltme aşamasında her `needs_validation` kaydı önce düzeltilmemiş kodda başarısız olan bir regresyon testiyle kanıtlandı, sonra düzeltildi. Aşağıdaki "Düzeltildi" satırlarının hepsi bu testlerle korunur.

## Denetim 1 (resget-run-1)

- Kaynak: `9d09e6d`, 9 Ekim 2026. Kapsam: tüm depo, 45 kapsam birimi.
- Bütçe sınırı nedeniyle 16 birim ertelendi (denetim 2'nin kapsamı oldu).
- Sonuç: 20 `needs_validation`, 1 `rejected` (`api.storefront.marketplace-per-restaurant-query-fanout`).

| PR | Kapatılan kayıtlar |
|---|---|
| #133 | `workflows.claude-triage.anonymous-issue-text-reaches-gh-issue-edit-with-secrets`, `workflows.release.promotion-not-bound-to-protected-main` |
| #134 | `webhooks/outbound-ssrf-dns-rebinding-lookup-fetch-toctou` (bağlantı anında adres sabitleme, `common/net/public-https.ts`), `email/sns-verifier/cert-cache-keyed-by-raw-url-unbounded` |
| #135 | `resget:customers/phone-search-oracle-defeats-contact-masking`, `resget:dispatch/trip-dto-unmasked-customer-contact`, `resget:orders/staff-order-detail-exposes-tracking-token-and-delivery-pin`, `resget:staff.updateMember:status-only-change-skips-grantable-and-rank-check` |
| #136 | `web.middleware.hostcache-unbounded-unvalidated-host-keys`, `api.storefront.qr-view-unthrottled-session-row-insert` |
| #137 | `journeys-bypass-campaign-approval-and-send-limits` |
| #138 | `payments/webhook-capture-ack-ignores-distinct-provider-transaction` (sipariş ve bahşiş), `storefront/inactive-category-items-orderable`, `storefront/delivery-zone-fee-trusts-client-point`, `storefront/unpaid-anonymous-order-holds-stock-and-coupon`, `coupons/eligibility-keyed-to-unverified-phone` |
| #139 | `auth/refresh-token-stateless-no-revocation` (`AuthSession`), `web/session-routes-login-csrf-no-browser-binding`, `social.meta-oauth.state-not-bound-to-completing-browser`, `resget:realtime/sse-subscription-outlives-authorization-revocation` |
| #140 | Sürüm hattında imaj özetlerinin derleme kaynağı doğrulaması (`gh attestation verify`); denetim 1'in sertleştirme notu |
| #141 | `payments/webhook-capture-ack-ignores-distinct-provider-transaction` için #138'in açık bıraktığı iki boşluk: açık hesap payında ikinci tahsilatın iadesi ve ödeme başına tek açık barındırılan oturum |

## Denetim 2 (resget-run-2)

- Kaynak: `9d75039`, 12 Ekim 2026. Kapsam: denetim 1'in ertelediği 16 birim; denetim 1'in kapsadığı 29 birim `out_of_scope`.
- Sonuç: 17 `needs_validation` (iki avcının aynı kökten bulduğu iki aday tek kayda birleştirildi), reddedilen yok.

| PR | Kapatılan kayıtlar |
|---|---|
| #143 | `staff-invite-delivery-platform-paid-message-no-throttle`, `restaurant-signup.unbounded-trial-and-credit-grant`, `auth/api-key-sync-scrypt-before-throttle`, `payments/iyzico-unsigned-callback-outbound-readback-unthrottled`, `partner-referral.sybil-self-referral-reward` |
| #144 | `webhooks/payload-unmasked-bypasses-contact-view-permission`, `webhooks/delivery-payload-survives-account-deletion-and-replays`, `ads.deliver.erased-customer-hashed-email-disclosure`, `webhooks/shared-fifo-runner-tenant-starvation-via-test-queue` |
| #145 | `billing.service/issue-period-int32-overflow-aborts-run`, `payments.service/self-service-platform-psp-mode-with-zero-psp-rate`, `settlement/self-declared-country-selects-tax-defaults`, `billing.service/billing-card-survives-card-owner-membership-loss` |
| #146 | `invite-accept-reapplies-no-authority-check-on-passive-member-or-issuer`, `ratings.edit-ratingsum-stale-delta`, `reviews.public-author-name-unscrubbed`, `tenant-image-url-unrestricted-host-diner-beacon` |

Düzeltmelerde verilen ürün kararları (sahip değiştirebilir):

- Self-servis kayıt yalnızca `SETTLEMENT_DEFAULTS_BY_COUNTRY` tablosunda satırı olan ülkelere açıktır; diğer ülkelerde restoranı süper admin açar (`docs/MUTABAKAT.md`, `docs/PLATFORM_YONETIMI.md`).
- `PLATFORM_PSP` moduna geçiş, süper admin restoranın PSP oranını girmeden reddedilir (`docs/ODEME.md`).
- PRO deneme süresi ve hoş geldin kredisi kullanıcı başına yalnızca ilk restorana verilir; sonrakiler `BASIC` açılır (`docs/PLAN_MATRISI.md`).
- Restoran tavsiyesi ödülünde siparişler, iki restoranın da üyesi olmayan farklı müşteri başına bir kez sayılır (`docs/RESTORAN_TAVSIYE.md`).
- Logo ve menü görselleri yalnızca https ve platformun yükleme kökeni ya da `IMAGE_HOST_ALLOWLIST`; web her sayfada `img-src` kısıtlı Content-Security-Policy gönderir (`docs/GUVENLIK.md`, "Görsel bağlantıları").

## Ertelenen birimler (bir sonraki denetimin ilk işi)

Denetim 2'nin dalga sonrası kapsam eleştirmeni beş eksik birim önerdi; bütçe kalmadığı için taranmadılar:

1. Misafir ve kimlik doğrulamasız tetiklenen, platformun ya da restoran cüzdanının ödediği SMS/WhatsApp gönderimleri (platform başvuru formunun onay SMS'i, sipariş durum mesajları, alıcı başına ve toplam sınırlar) ve kimliksiz atıf girişi.
2. Barındırılan ödeme oturumunun hangi hesaba açıldığı (canlı `paymentMode`) ile ödeme satırının anlık görüntüsü arasındaki uyumsuzluk ve hiçbir ödemeyle eşleşmeyen sağlayıcı bildirimleri.
3. Deneme süresindeki self-servis işletmelerin platform maliyetli veya küresel benzersiz özellikleri: kendi alan adı talebi, e-posta gönderici alan adı ve test e-postası, yapay zeka bütçesi.
4. Kurye ağı bildiriminin siparişi yürütmesi: olay sırası ve tekrarı, `finalFeeMinor` sınırları, iptal ve bahşiş aktarımı.
5. Kart kasası ve platform cüzdanı bağlama tamamlamasının kullanıcıya bağlanması (gerçek kasa adaptörü gelmeden önce).

## Açık kalan riskler ve sahip işleri

- `CommissionInvoice` tutar sütunları 32 bit. Taşan işletme artık diğerlerini durdurmuyor ve raporlanıyor; sütunların BigInt'e geçişi ayrı bir şema kararı.
- PayTR'de 15 dakikalık oturum penceresinden sonra açılan oturum ile hâlâ ödenebilir eski oturum aynı `merchant_oid` değerini paylaşabilir; ikinci ödeme fazla tahsilat iadesine düşer (`docs/ODEME.md`).
- Herkese açık sipariş uç noktası doğrulanmamış telefonla müşteri oluşturduğu için uydurma numaralarla tavsiye ödülü hâlâ zorlanabilir; azaltıcılar eşik, yıllık sınır ve konsol listesi.
- Uç (edge) hız sınırı Caddy'de yok; CDN veya WAF önerisi ve önce `trust proxy` değişikliği `docs/CICD_GUIDE.md` içinde.
- Sahip işleri: Meta yönlendirme adresinin (`${PUBLIC_APP_URL}/api/oauth/meta/callback`) Meta uygulamasına kaydı; `docs/CICD_GUIDE.md` içindeki GitHub ayarları kontrol listesi.
