# Güvenlik Politikası

## Bir güvenlik açığı bildirme

Güvenlik sorunları için herkese açık bir issue açmayın. GitHub'ın özel güvenlik açığı bildirimini kullanın: repository'nin Security sekmesi altındaki "Report a vulnerability" butonu. 5 iş günü içinde yanıt alırsınız.

Etkilenen bileşeni (api, web, shared, database, deploy), yeniden üretme adımlarını ve beklenen etkiyi (örneğin restoranlar arası veri erişimi, hakediş hesabında sapma) belirtin.

## Desteklenen sürümler

Yalnızca `main` üzerindeki en son sürüm düzeltme alır.

## Mevcut önlemler

- Dependabot ile 7 günlük bekleme süresiyle bağımlılık güncellemeleri; major sürümler elle
- Her PR'da `pnpm audit` (high ve üzeri)
- Container imajları salt okunur dosya sisteminde, root olmayan kullanıcıyla, tüm capability'ler düşürülmüş çalışır
- OTP kodları yalnızca karma (hash) olarak saklanır; telefon başına pencere içinde en çok 3 kod, kod başına en çok 5 deneme
- Loglarda telefon numaraları maskelenir; OTP metni yalnızca yerel geliştirmede görünür
- Kiracı izolasyonu guard katmanında zorlanır; gövdedeki `restaurantId` rota ile çelişirse istek reddedilir
- Para hesapları tam sayı minör birimle yapılır ve kimlik denklemi testlerle doğrulanır (`settlement.spec.ts`)
