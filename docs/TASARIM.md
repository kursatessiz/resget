# Tasarım sistemi (Perfect UI)

Ürünün tek görsel dili açık kaynak Perfect UI kitidir (https://perfectui.dev, npm `@chrissgon/perfectui` 1.0.0, MIT). Kurallar kardeş platformla aynıdır; token'lar ve yardımcılar `packages/shared/src/design` içinde yaşar ve web ile (ileride) mobil için tektir.

## Kararlar

1. Varsayılan aile `perfect`. İsteğe bağlı aileler (`noir`, `nefes`, `saha`, `atolye`) kod olarak mevcuttur ama yalnızca süper admin bir restoran için izin verirse çizilir; `resolveTheme()` izinsiz saklı aileyi `perfect` olarak çizer.
2. Restoran markası: logo ve birincil renk (`Restaurant.themePrimary`). Logo dosya olarak yüklenir (`POST /restaurants/:id/logo`, çok parçalı `file` alanı; PNG, JPEG veya WebP, en çok 2 MB; tür dosya baytlarından okunur, istemcinin beyanına bakılmaz). Dosya `UPLOADS_DIR` altında rastgele adla durur (üretimde `uploads_data` birimi, yedeğe girer), API `GET /uploads/logos/:restaurantId/:file` ile değişmez önbellek başlığıyla sunar, restoran satırı mutlak URL taşır; harici bir görsel bağlantısı da verilebilir. Logo panel kenar çubuğunda, masa QR ve restoran sipariş sayfasının başlığında görünür. Birincil renk WCAG 4,5:1 eşiğinin altında kalırsa `deriveBrandPalette()` otomatik düzeltir; ekranda uyarı gösterilmez.
3. Kullanıcı yalnızca açık / koyu / cihazla aynı modunu seçer (`data-pui-mode`).
4. Gradyan yok. Birincil butonlar ve başlık bandı düz `pui-solid pui-theme`. İç içe kart yok, mor arka plan yok, varsayılan shadcn paleti yok.
5. Yazı tipi Inter, `@fontsource/inter` ile gömülür; çalışma zamanında harici font isteği yoktur. İkonlar Lucide 16 px.

## Üç sınıf kuralı

Her öğe şekil + stil + renk rolüdür: `pui-btn pui-solid pui-theme`. Şekiller: `pui-btn`, `pui-card` (+ `pui-card-header`, `pui-card-content`), `pui-badge`, `pui-chip`, `pui-input`, `pui-table`, `pui-list`, `pui-modal`. Stiller: `pui-solid`, `pui-soft`, `pui-outline`, `pui-link`. Roller: `pui-theme`, `pui-success`, `pui-warn`, `pui-error`, `pui-muted`, `pui-surface`, `pui-inverse`.

Ekranlar bu sınıfları doğrudan yazmaz; `apps/web/src/components/ui` bileşenlerini kullanır (`Button`, `LinkButton`, `Card`; diğerleri ekran geldikçe eklenir). Tailwind yalnızca yerleşim içindir (flex, grid, gap, padding, width); renk, çizgi, köşe, gölge ve tipografi için kullanılmaz. `tailwind.config.ts` preflight'ı kapatır; minimal reset `globals.css` içindeki `reset` katmanındadır.

## ThemeRoot

`apps/web/src/components/ThemeRoot.tsx` sunucu bileşenidir: `resolveTheme()` sonucunu `themeCssVariables()` ile `--pui-*` değişkenlerine çevirir ve alt ağaca uygular. Herkese açık menü sayfası restoranın rengini bu yolla alır; ek istemci JavaScript'i gerekmez.

## Token tablosu

| Token | Açık | Koyu | CSS |
|---|---|---|---|
| Zemin | `#ffffff` | `#000000` | `--pui-bg` |
| Soluk zemin | `#f3f4f6` | `#111827` | `--pui-bg-muted` |
| Metin | `#000000` | `#ffffff` | `--pui-text` |
| Soluk metin | `#676d7b` | `#9ca3af` | `--pui-text-muted` |
| Çizgi | `#d1d5db` | `#374151` | `--pui-border` |
| Marka (varsayılan) | `#0092cd` | `#07b6f0` | `--pui-theme` (düzeltilmiş tek değer) |
| Başarı / uyarı / hata | `#16a34a` / `#d97706` / `#dc2626` | `#22c55e` / `#f59e0b` / `#ef4444` | `--pui-success` / `--pui-warn` / `--pui-error` |

Köşe 6 px (`--pui-radius`, kartlarda 1,5 katı), boşluk 4 px (`--pui-space`), yazı 14 px, çizgi 1 px.

## Yeni ekran yazarken

1. Metinleri önce `messages/tr` ve `messages/en` dosyalarına ekle.
2. Yerleşimi Tailwind ile, görünümü `components/ui` ile kur.
3. Renk yazma ihtiyacı doğarsa token eksiktir; `packages/shared/src/design` güncellenir, ekran değil.
