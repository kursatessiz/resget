[![CI](https://github.com/kursatessiz/resget/actions/workflows/ci.yml/badge.svg)](https://github.com/kursatessiz/resget/actions/workflows/ci.yml)
[![Repository](https://img.shields.io/badge/GitHub-kursatessiz%2Fresget-blue?logo=github)](https://github.com/kursatessiz/resget)

# Resget

Restoranlar için düşük komisyonlu sipariş ve ödeme ağı. Üç katman tek üründe:

- **Pazaryeri**: sipariş başına yüzde 1 platform komisyonu. Restoran varsayılan olarak kendi sanal POS'unu bağlar, para doğrudan kendi hesabına gelir, komisyon ay sonunda fatura edilir; isteyen restoran için platformun kendi PSP'si de vardır. Kart numarası platforma asla girmez. Teslimatı varsayılan olarak restoran yapar.
- **Restoran yazılımı**: menü, sipariş ekranı, masa QR ve kendi sipariş sayfası süresiz ücretsiz (`BASIC`). CRM, kampanya, analitik ve sadakat ücretli `PRO` katmanındadır; yeni restoran `PRO`'yu deneme süresiyle alır. SMS ve WhatsApp ayrı kredi paketleridir.
- **Kurye**: platform filo kurmaz. Kendi kuryesi olmayan restoran anlaşmalı kurye ağından API ile teklif alır; ücret ayrı satırda görünür, komisyona asla girmez.

Müşteri edinme masadaki QR ile başlar: tarama uygulama kurulumu gerektirmeyen bir web menüsü açar, oradan masaya sipariş, eve sipariş ve telefonla kayıt sunulur. Büyüme tek ilçeden başlar; belirleyici ölçüt restoran başına günlük sipariş sayısıdır.

Geliştirme kuralları `CLAUDE.md`, devir notları ve backlog `HANDOVER.md` dosyasındadır. İş modeli ve sayıları `docs/IS_MODELI.md`, yol haritası `docs/YOL_HARITASI.md` içindedir. Dokümantasyon Türkçe; kod, tanımlayıcılar ve commit mesajları İngilizcedir.

## Monorepo yapısı

```
.
├── apps/
│   ├── api/                 # NestJS 11 REST API (Prisma, Passport JWT, Swagger)
│   └── web/                 # Next.js 15 (App Router): restoran paneli, herkese açık menü (/m/<token>), BFF proxy
├── packages/
│   ├── shared/              # Tipler, Zod şemaları, enum'lar, izinler, hakediş motoru, planlar, kurye arayüzü, masa QR, tasarım, i18n
│   └── database/            # Prisma şeması, ileri yönlü migration'lar, geliştirme seed'i
├── deploy/
│   ├── docker/              # Çok aşamalı üretim Dockerfile'ları
│   ├── docker-compose.prod.yml
│   ├── docker-compose.dev.yml
│   └── caddy/Caddyfile
├── docs/                    # Modül ve işletim dokümanları (Türkçe)
├── .github/workflows/ci.yml
├── CLAUDE.md
└── HANDOVER.md
```

## Yerel geliştirme

Gereksinimler: Node.js 22, pnpm 9, yerel Postgres ve Redis için Docker.

```bash
pnpm install --frozen-lockfile
docker compose -f deploy/docker-compose.dev.yml up -d
cp apps/api/.env.example apps/api/.env
pnpm turbo run build
pnpm --filter @resget/database exec prisma migrate deploy
pnpm --filter @resget/database db:seed
pnpm --filter @resget/api dev        # http://localhost:4000, Swagger: /api/docs
pnpm --filter @resget/web dev        # http://localhost:3000
```

Seed, `demo-lokanta` adlı bir restoran, dört masa (QR adresleri `GET /restaurants/:id/tables` ile listelenir), sahip hesabı (`05320000002`) ve süper admin (`05320000001`) oluşturur. Geliştirmede SMS sağlayıcısı MOCK'tur; OTP kodu API logunda görünür.

## Doğrulama

```bash
pnpm turbo run build typecheck test
pnpm audit --audit-level high
```

CI (`.github/workflows/ci.yml`) aynı adımları çalıştırır; ayrıca migration'ları boş bir Postgres'e uygular ve sapma denetler, API e2e (supertest) ve web e2e (Playwright) testlerini koşar, script ve workflow'ları lint eder, Docker imajlarını derler. Güvenlik taramaları (CodeQL, TruffleHog, zizmor, dependency review, Scorecard), Lighthouse bütçesi, release ve deploy hattı ile Claude ajan workflow'ları `docs/CICD_GUIDE.md` içinde anlatılır.

## Dokümanlar

| Doküman | İçerik |
|---------|--------|
| `docs/IS_MODELI.md` | Fizibilite sayıları, varsayımlar, birim ekonomisi |
| `docs/YOL_HARITASI.md` | Faz 0 / 1 / 2 ve geçiş eşikleri |
| `docs/MIMARI.md` | Uygulamalar, paketler, istek akışı, guard'lar |
| `docs/VERI_MODELI.md` | Tablolar ve ilişkiler |
| `docs/MUTABAKAT.md` | Para akışı, hakediş motoru, defter ve tevkifat |
| `docs/ODEME.md` | Ödeme modları (kendi POS / platform PSP), kart kasası, komisyon faturası |
| `docs/YEMEK_KARTI.md` | Yemek kartları: kapıda ve çevrim içi kabul, ödeme adımı, webhook, kapıda tahsilat |
| `docs/FIYATLANDIRMA.md` | Plan katmanları, deneme süresi, mesaj kredileri |
| `docs/KURYE.md` | Üçüncü taraf kurye entegrasyonu ve ücret politikası |
| `docs/SIPARIS_VE_SEVK.md` | Sipariş durum makinesi, kendi kurye sevki, çok duraklı rota, canlı takip (SSE) |
| `docs/MASA_QR.md` | Masa QR akışı ve dönüşüm hunisi |
| `docs/PERSONEL.md` | Personel daveti, davet bağlantısı ve rol şablonları |
| `docs/MESAJLASMA.md` | Mesajlaşma motoru, sipariş bildirimleri, kredi düşümü ve satın alma |
| `docs/I18N.md` | Çoklu dil kuralları |
| `docs/TASARIM.md` | Perfect UI tasarım sistemi |
| `docs/CICD_GUIDE.md` | CI, imajlar, sunucu kurulumu |
