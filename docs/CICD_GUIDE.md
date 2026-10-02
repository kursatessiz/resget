# CI/CD ve işletim

## CI (`.github/workflows/ci.yml`)

Her PR'da ve `main`'e push'ta:

| İş | Ne yapar |
|---|---|
| verify | `pnpm install --frozen-lockfile`, Prisma şema doğrulama, build, typecheck, birim testleri, `pnpm audit --audit-level high` |
| migrations | Boş Postgres 16'ya `prisma migrate deploy`, şema ile migration'lar arasında sapma kontrolü, seed |
| workflows | actionlint |
| images | API ve web Dockerfile'larının derlenmesi (push edilmez) |

Tüm action'lar tam commit SHA'sına sabitlidir; `permissions: contents: read`.

## Yerelde CI ile aynı kontroller

```bash
pnpm install --frozen-lockfile
pnpm turbo run build typecheck test
pnpm audit --audit-level high
```

## Üretim (henüz kurulmadı; A10)

Hedef: Ubuntu 24.04, 6 GB RAM, 4 vCPU. İmajlar CI'da GHCR'ye `sha-<commit>` etiketiyle yayınlanır; sunucu `deploy/docker-compose.prod.yml` ile yalnızca çeker. Deploy sırası: yedek, `prisma migrate deploy`, imaj değişimi, smoke test (`/health` Postgres ve Redis ister, web `/`), 3 başarısız denemede önceki imaja dönüş. Script'ler (`deploy.sh`, `backup.sh`, `rollback.sh`, `server-init.sh`) ve `release.yml` backlog A10 ile gelir; CI'ya `shellcheck` işi o PR'da eklenir.

Sunucu `.env` dosyası `.env.example` şablonundan doldurulur; gizli bilgiler `openssl rand -hex 32` ile üretilir. Üretimde `PAYMENT_PROVIDER=MOCK` ve joker CORS reddedilir.

## Repository ayarları (sahip)

- `main` korumalı: PR zorunlu, CI işleri zorunlu, lineer geçmiş.
- Dependabot güvenlik güncellemeleri açık.
- Secret scanning ve private vulnerability reporting açık.
- GHCR paket izinleri (A10 ile).
