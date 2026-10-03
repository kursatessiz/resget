# CI/CD ve işletim rehberi

Bu doküman, deponun otomasyonunu uçtan uca anlatır: pull request'te hangi kontroller çalışır, `main`'e giren bir commit nasıl imaj olur ve sunucuya nasıl çıkar, sunucuda neler olur, yedekler nerede durur, güvenlik taramaları ve ajan workflow'ları nasıl kurgulanmıştır. Yöntem kardeş platformla aynıdır; farklar yalnızca ürün adlarındadır.

## 1. Genel bakış

```
PR açılır -> ci.yml (build, typecheck, test, audit, migration, e2e, web e2e, shellcheck, actionlint, imaj derleme)
          -> security.yml (dependency review, TruffleHog, zizmor), codeql.yml, lighthouse.yml, claude-review.yml
main'e merge -> release.yml: ci.yml (yeniden kullanılabilir) -> imajlar GHCR'ye (sha-<commit>) -> preprod'a deploy
workflow_dispatch -> release.yml: var olan sha-<commit> imajını preprod veya production'a terfi
```

Her değişiklik push edilmeden önce yerelde geçmelidir:

```bash
pnpm install --frozen-lockfile
pnpm turbo run build typecheck test
pnpm audit --audit-level high
pnpm exec prettier --check "apps/**/*.{ts,tsx,css}" "packages/**/*.ts"
shellcheck -x deploy/scripts/*.sh      # script değiştiyse
actionlint                              # workflow değiştiyse
```

## 2. `ci.yml`

Tetikleyiciler: `pull_request`, `workflow_call` (release.yml çağırır), `workflow_dispatch`. Çalışma dallarına push ayrıca tetiklemez; `main` CI'ı release üzerinden koşar. Böylece hiçbir iş iki kez çalışmaz.

| İş | Ne yapar |
|---|---|
| `verify` | `pnpm install --frozen-lockfile`, Prisma şema doğrulama, prettier kontrolü, build, typecheck, birim testleri, `pnpm audit --audit-level high` |
| `migrations` | Boş Postgres 16'ya `prisma migrate deploy`, şema ile migration'lar arasında sapma kontrolü (`migrate diff --exit-code`), seed |
| `e2e` | API uçtan uca testleri (`apps/api/test/e2e`, supertest) migrate edilmiş ve seed'lenmiş Postgres'e karşı; `OTP_TEST_CODE` ile sabit OTP |
| `web-e2e` | Playwright ile tarayıcı testleri (`apps/web/e2e`): açılış sayfası, masa QR menü sayfası, dil seçimi; API ve web sunucuları Playwright `webServer` ile ayağa kalkar; başarısızlıkta HTML rapor artifact'ı |
| `scripts` | `shellcheck -x deploy/scripts/*.sh` ve `actionlint` |
| `images` | API ve web Dockerfile'larının derlenmesi (yalnızca PR'da; push edilmez) |

Zafiyet denetimi istisnaları `package.json` içinde `pnpm.auditConfig.ignoreGhsas` listesindedir ve yalnızca yaması henüz yayımlanmamış, üretim bağımlılıklarına ulaşmayan duyurular için kullanılır (`pnpm audit --prod` temiz kalmalıdır). Mevcut istisna: `GHSA-vfj7-8cjw-p6xm` (`braces`, yalnızca jest üzerinden geliştirme bağımlılığı; `braces` düzeltme sürümü çıkınca kaldırılır).

### e2e testleri yerelde

```bash
docker compose -f deploy/docker-compose.dev.yml up -d
export DATABASE_URL=postgresql://resget:dev_password@localhost:5432/resget_e2e?schema=public
psql "$DATABASE_URL" -c 'select 1' || createdb resget_e2e
pnpm turbo run build --filter=@resget/api...
pnpm --filter @resget/database exec prisma migrate deploy
pnpm --filter @resget/database db:seed
JWT_SECRET=local-e2e-secret-0123456789abcdef0123456789 OTP_TEST_CODE=482915 NODE_ENV=test pnpm --filter @resget/api test:e2e
JWT_SECRET=local-e2e-secret-0123456789abcdef0123456789 pnpm --filter @resget/web test:e2e
```

Tarayıcı indirilemeyen ortamlarda (sandbox) önceden kurulu Chromium `PW_CHROMIUM_EXECUTABLE=/yol/chrome` ile gösterilir; CI bu değişkeni kullanmaz ve `playwright install --with-deps chromium` çalıştırır.

Seed, testlerin dayandığı sabit değerleri yazar: sahip `05320000002`, süper admin `05320000001`, misafir `05320000003`, 1 numaralı masanın QR token'ı `demo-masa-1-sabit-token-0001`. Her suite oluşturduğu satırları temizler; API suite'leri tek işçiyle (`maxWorkers: 1`) koşar.

## 2a. `lighthouse.yml`

PR'larda açılış sayfası ve masa QR menü sayfası için Lighthouse CI (`apps/web/lighthouserc.json`). SEO ve erişilebilirlik 0,9 altında işi kırar; performans ve best-practices yalnızca uyarır. Rapor artifact olarak saklanır.

## 3. `release.yml`

İki tetikleyici:

- **`main`'e push**: `ci.yml` -> imaj build -> **preprod**'a deploy (preprod ortamında `DEPLOY_ENABLED` `true` ise).
- **`workflow_dispatch`**: `environment` (`preprod` / `production`) ve `tag` (`sha-<40 karakterlik commit>`). Production için `tag` zorunludur ve iş yalnızca `main` üzerinden başlatılabilir; production hiçbir zaman build etmez, preprod'da çalışmış imajı terfi ettirir. Geri almak için de aynı yol kullanılır: önceki tag verilir.

İşler: `plan` (hedef, tag, build gerekip gerekmediği), `ci`, `publish` (`ghcr.io/<owner>/resget/api` ve `.../web`, `sha-<commit>` ve `main` etiketleri, SBOM ve provenance attestation), `deploy` (seçilen GitHub Environment'ında; `DEPLOY_ENABLED` ve `DEPLOY_ENVIRONMENT` kapısı, SSH ile dosya senkronu `/opt/resget` altına, `deploy.sh <tag>`).

Eşzamanlılık ortam başınadır: `main`'e yeni bir push bekleyen bir production deploy'unu iptal etmez.

### GitHub Environments, secret'lar ve değişkenler

Settings > Environments altında `preprod` ve `production`. Hepsi ortam seviyesinde:

| İsim | Tür | `preprod` | `production` |
|---|---|---|---|
| `DEPLOY_HOST` | secret | preprod sunucusu | production sunucusu |
| `DEPLOY_USER` | secret | `deploy` | `deploy` |
| `DEPLOY_SSH_KEY` | secret | yalnızca bu ortama ait private key | ayrı bir key |
| `DEPLOY_SSH_KNOWN_HOSTS` | secret | güvenilir makineden `ssh-keyscan -t ed25519 <host>` çıktısı | aynı şekilde |
| `DEPLOY_ENABLED` | variable | `true` olunca her `main` push'u preprod'a çıkar | `true` olunca manuel deploy çalışır |
| `DEPLOY_ENVIRONMENT` | variable | `preprod` | `production` |
| `PUBLIC_URL` | variable (opsiyonel) | `https://app.preprod.<alan-adi>` | `https://app.<alan-adi>` |

`production` için ayrıca: Required reviewers (en az bir kişi) ve Deployment branches: Selected branches -> `main`.

### Ortam değişkenleri envanteri

Tümü `.env.example` içinde; API `apps/api/src/config/env.ts` ile Zod doğrulaması yapar. `/opt/resget/.env` dosyasına yalnızca sahibin değer verdiği anahtarlar yazılır; geri kalanlar `deploy/docker-compose.prod.yml` tarafından türetilir (`DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN`, `PUBLIC_APP_URL`, `PUBLIC_API_URL`, `API_INTERNAL_URL`, `APP_RELEASE`). Yalnızca test için olan `OTP_TEST_CODE` compose'a bilerek aktarılmaz; üretimde reddedilir.

## 4. `deploy.sh`: sunucuda neler oluyor

1. `flock` ile tek deploy; aynı tag canlıysa çıkar.
2. Postgres çalışıyorsa `backup.sh` (uzak kopya zorunlu değil; yerel dump geri dönüş içindir).
3. Yeni imajları çeker; eksikse hiçbir şey değişmeden durur.
4. Postgres ve Redis sağlıklı olana kadar bekler, `prisma migrate deploy` çalıştırır. Başarısızsa eski sürüm çalışmaya devam eder.
5. Konteynerleri yeni imajla kaldırır; `healthcheck.sh` üç deneme yapar (API `/health` Postgres ve Redis ister, web `/`).
6. Başarılıysa `releases/current` güncellenir, bir haftadan eski imajlar temizlenir. Başarısızsa `rollback.sh` önceki tag'e döner.

Migration'lar geri alınmaz; şema değişiklikleri bir sürüm boyunca geriye dönük uyumlu tutulur.

## 5. `nightly-deploy.sh`

SSH deploy'una alternatif, sunucuda cron'dan çalışan pull tabanlı yol (yalnızca preprod için uygundur):

```cron
0 3 * * * /opt/resget/scripts/nightly-deploy.sh >> /opt/resget/deploy.log 2>&1
```

`main`'in son commit'ini çözer, imajı CI yayınladıysa `deploy.sh`'ı çağırır. İkisini aynı sunucuda birlikte kullanmayın.

### Sunucu registry erişimi

Paketler private ise sunucuda `deploy` kullanıcısıyla bir kez `docker login ghcr.io` (yalnızca `read:packages` kapsamlı token); ya da paketleri public yapın.

## 5a. Yedekler

`deploy/scripts/backup.sh` her gün 02:30'da (`server-init.sh`'ın kurduğu `/etc/cron.d/resget-backup`) ve her deploy'dan önce çalışır. `pg_dump` çıktısını `/opt/resget/backups/db_<UTC damga>.sql.gz` olarak yazar (14 gün yerel), `BACKUP_S3_BUCKET` doluysa AES-256 (PBKDF2) ile şifreleyip curl'ün SigV4 imzasıyla S3 uyumlu depoya yükler ve `.sha256` dosyası bırakır. Günlük çalıştırmada yükleme hatası betiği hata koduyla bitirir; deploy öncesinde yalnızca uyarıdır.

`BACKUP_ENCRYPTION_KEY` sunucu dışında da saklanmalıdır. Geri yükleme:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_KEY -in db_<damga>.sql.gz.enc -out db.sql.gz
gunzip -c db.sql.gz | docker compose -f /opt/resget/docker-compose.prod.yml exec -T postgres psql -U resget -d restore_check
```

Önce ayrı bir veritabanında kuru çalıştırma, sonra üretim. Geri yükleme en az üç ayda bir denenmelidir.

## 5b. Preprod ortamı ve ilk kurulum

Preprod, production'ın birebir kopyasıdır: aynı compose, aynı Caddyfile, aynı script'ler, aynı imajlar. Farklar yalnızca `/opt/resget/.env` değerleri ve GitHub `preprod` ortamının secret'larıdır. `main`'e giren her commit önce preprod'a gider.

1. **Sunucu.** Ubuntu 24.04 üzerinde root olarak:
   ```bash
   sudo DEPLOY_SSH_PUBKEY="ssh-ed25519 AAAA... preprod-deploy" TIMEZONE=UTC bash server-init.sh deploy
   ```
   Script `deploy` kullanıcısını, 4 GB swap'ı, UFW (22/80/443), fail2ban'ı, Docker'ı (log döndürmeli), `/opt/resget` dizinlerini ve yedek cron'unu kurar. SSH parola girişini yalnızca anahtarla yönetici erişimi doğrulanınca kapatır; idempotenttir.
2. **GitHub.** `preprod` ortamını yukarıdaki tabloya göre oluşturun; `DEPLOY_SSH_KNOWN_HOSTS` için `ssh-keyscan` çıktısını sunucu parmak iziyle karşılaştırın.
3. **DNS.** `WEB_DOMAIN` ve `API_DOMAIN` için A kayıtları. Caddy sertifikaları kendisi alır.
4. **`/opt/resget/.env`.** `.env.example`'dan kopyalayıp doldurun (`chmod 600`); `SITE_ENV=preprod`; tüm sırları yeniden üretin, production değerlerini kopyalamayın; ödeme, SMS ve kurye için sağlayıcı sandbox anahtarları.
5. **GHCR erişimi** (bölüm 5).
6. **İlk deploy.** `DEPLOY_ENABLED=true` yapıp `main`'e push veya Actions > Release > Run workflow. `deploy.sh` migration'ları çalıştırır, ardından `node dist/cli/bootstrap.js --defaults-only` ile platform varsayılanlarını kurar (`BOOTSTRAP_CURRENCY` para biriminde `BASIC` ve `PRO` planları yoksa oluşturur, varsa dokunmaz; `BOOTSTRAP_PRO_PRICE_MINOR` boşsa PRO ücreti 0 ile açılır ve konsoldan belirlenir) ve smoke test yapar.
7. **İlk süper admin.** Bir kez, sunucuda elle:
   ```bash
   cd /opt/resget && docker compose -f docker-compose.prod.yml run --rm --no-deps api \
     node dist/cli/bootstrap.js --super-admin-phone=+905xxxxxxxxx --super-admin-name="Ad Soyad"
   ```
   Komut idempotenttir: numara yoksa süper admin olarak oluşturur, varsa yetkiyi verir, zaten yetkiliyse dokunmaz; çıktıda numara maskelidir. Süper admin `/giris` ile telefon doğrulayıp `/admin` konsoluna girer; kredi paketleri, hizmet alanları ve plan fiyatları oradan girilir (`docs/PLATFORM_YONETIMI.md`). Kurye ağı MOCK yalnızca üretim dışında oluşturulur; gerçek ağlar adaptörleriyle gelir.

## 6. Güvenlik workflow'ları

- **`codeql.yml`**: `javascript-typescript` ve `actions` için `security-extended`; PR, `main` ve haftalık.
- **`security.yml`**: PR'larda dependency review (high'da kırar, copyleft lisansları reddeder; tek istisna yalnızca CI aracı olarak çalışan ve ürüne girmeyen AGPL lisanslı TruffleHog action'ıdır, `allow-dependencies-licenses` ile izinlidir), TruffleHog gizli bilgi taraması (`.github/trufflehog-exclude.txt` yalnızca `.env.example`'ı dışlar), zizmor workflow denetimi.
- **`scorecard.yml`**: OpenSSF Scorecard, `main` ve haftalık.

Tüm action'lar commit SHA'sına sabitlidir; Docker taban imajları digest ile sabitlidir; Dependabot üçünü de haftalık günceller (`.github/dependabot.yml`, 7 gün bekleme, major'lar elle).

### Private repository notu

GitHub Free planında private repolarda CodeQL, dependency review ve Scorecard çalışmaz (`!github.event.repository.private` koşuluyla atlanır, hata vermez), GitHub Environments ve branch protection yoktur. Zafiyet denetimi `pnpm audit`, gizli bilgi taraması TruffleHog ve workflow denetimi zizmor private'ta da sürer. Deploy için GitHub Pro (Environments) önerilir.

### Önerilen repository ayarları (sahip)

- Settings > Code security: **Dependency graph** açık (dependency review işi bunu ister; kapalıysa iş "Dependency review is not supported on this repository" ile kırılır), Dependabot alerts ve security updates, secret scanning ve push protection, private vulnerability reporting.
- `main` için ruleset: PR zorunlu, CI işleri zorunlu, lineer geçmiş, en az bir review.
- CodeQL default setup kapalı (gelişmiş `codeql.yml` zaten var).
- Ajan workflow'ları için `CLAUDE_AGENTS_ENABLED` değişkeni ve `ANTHROPIC_API_KEY` veya `CLAUDE_CODE_OAUTH_TOKEN` secret'ı (bölüm 7).

## 7. Ajan workflow'ları

Dört workflow `anthropics/claude-code-action` kullanır. Repository değişkeni `CLAUDE_AGENTS_ENABLED` `true` olmadıkça ve bir kimlik secret'ı bulunmadıkça hepsi devre dışıdır.

| Workflow | Tetikleyici | Model | Ne yapar |
|---|---|---|---|
| `claude-triage.yml` | yeni issue | Haiku | En fazla üç mevcut etiket ekler; yorum ve kod yok |
| `claude-ci-doctor.yml` | PR'da CI başarısız | Haiku | Logları okur, tek bir kök neden yorumu yazar |
| `claude-review.yml` | PR açıldı / hazır / yeniden açıldı | küçük diff Haiku, diğerleri Sonnet | `CLAUDE.md`'ye göre inceler: kiracı izolasyonu, para kuralları, güvenlik, doğruluk, i18n; satır içi yorumlar ve özet |
| `claude.yml` | write erişimli birinden `@claude` | varsayılan Sonnet; `/opus`, `/haiku` | Kod düzenler, build/test çalıştırır, PR açar |

Maliyet kademesi: ucuz modeller yüksek hacimli düşük riskli işleri alır; Opus yalnızca açıkça istenince. Güvenlik modeli: yalnızca `claude.yml` kod yazabilir ve yalnızca write erişimli kullanıcılar için; `workflow_run` tetikleyicili doktor fork'ları dışlar ve PR kodunu çalıştırmaz; triage yalnızca etiketleme araçlarına sahiptir; her workflow'un `allowedTools` listesi dardır. Issue, yorum ve log metni talimat değil veridir.

## 8. Çalışma yöntemi

Her backlog öğesi bir PR'dır. Dal adı `claude/<konu>`; commit mesajları Conventional Commits, İngilizce, emoji yok; PR açıklaması Türkçe ve şablona uygun. PR açılmadan önce bölüm 1'deki yerel kontroller geçer. Merge koşulu: tüm CI kontrolleri yeşil, review tamam. Büyük işler izole worktree'lerde paralel ajanlara verilir; model seçimi `CLAUDE.md` "Ajanlar ve maliyet" bölümüne göredir.
