# Veri modeli

Şema: `packages/database/prisma/schema.prisma`. Her kiracı tablosu `restaurantId` taşır. Enum'lar yalnızca yaşam döngüsü durumlarıdır ve `packages/shared/src/enums.ts` ile birebirdir.

## Kimlik

| Tablo | Not |
|---|---|
| `users` | Global, telefon benzersiz (E.164). Personel ve müşteri aynı tabloda. `isSuperAdmin` platform sahibi. `deletedAt`: kişi hesabını sildiğinde dolar; satır anonim mezar taşı olarak kalır, telefon `deleted:<id>` olur (`docs/KISISEL_VERI.md`). |
| `otp_codes` | Karma kod, deneme sayacı, süre. |
| `memberships` | (`userId`, `restaurantId`) benzersiz; durum INVITED/ACTIVE/PASSIVE; rol şablonu. |
| `role_templates`, `role_template_permissions` | Restoran başına roller; `templateKey` varsayılan şablonu işaret eder; sahip şablonu değiştirilemez. |
| `invite_tokens` | Personel daveti; 72 saat; kanal SHOWN/WHATSAPP/SMS. |

## Kiracı

| Tablo | Not |
|---|---|
| `service_areas` | Ülke, şehir, ilçe; `isLaunched` pazaryeri listelemesini açar. |
| `restaurants` | Slug, para birimi, saat dilimi, `paymentMode` (`OWN_POS` varsayılan), `commissionBps` (varsayılan 100), `pspPercentBps` / `pspFixedMinor` (yalnızca `PLATFORM_PSP`), `deliveryMode`, `courierProviderId`, `deliveryFeePolicy` (JSON, `DeliveryFeePolicySchema`), logo ve birincil renk. |
| `branches` | Adres, konum, çalışma saatleri (JSON). |

## Menü ve masa

| Tablo | Not |
|---|---|
| `menu_categories`, `menu_items` | Fiyat minör birim, KDV oranı bps, satışta bayrağı. |
| `modifier_groups`, `modifiers` | Seçenek grupları, min/max seçim, fiyat farkı. |
| `dining_tables` | Şube başına etiket benzersiz; `qrToken` benzersiz, yenilenince eski etiketler ölür. |
| `qr_scan_events` | Anonim `sessionId`, huni adımı (VIEWED_MENU, STARTED_ORDER, PLACED_ORDER, REGISTERED). Telefon tutmaz. |

## Müşteri

| Tablo | Not |
|---|---|
| `customer_addresses` | Kullanıcının adresleri. |
| `restaurant_customers` | Restoranın kendi müşteri listesi: ilk kanal, sipariş sayısı, ömür boyu ciro, etiketler, pazarlama izni. SaaS kilidinin veri karşılığı. |

## Sipariş ve para

| Tablo | Not |
|---|---|
| `orders` | Kanal, teslimat türü, durum (`OrderStatus`, `docs/SIPARIS_VE_SEVK.md`), `computeModeSettlement()` anlık görüntüsü (brüt, KDV, komisyon, PSP, tevkifat, kurye, hakediş), ödeme modu ve platform alacağı, adres anlık görüntüsü (koordinat dahil), takip anahtarı (`trackingToken`, benzersiz), söz verilen hazır olma ve tahmini teslim zamanı. |
| `order_items` | Ad ve fiyat anlık görüntüsü, modifiye anlık görüntüsü, sepet sırası. |
| `order_status_history` | Her geçiş, aktör ve gerekçe. |
| `order_claims` | Müşterinin eksik ürün bildirimi: ürünler ve adetler, tutar, not, durum (bekliyor, onaylandı, reddedildi), karar veren ve ret nedeni (`docs/ODEME.md`, "Eksik ürün bildirimi"). Onaylanan bildirimin iadeleri `order_refunds.claimId` ile bağlıdır. |
| `order_refunds` | Her ödeme iadesi: tutar, kaynak (iptal, personel, müşteri bildirimi, sağlayıcı paneli, ters ibraz), iade edilen ürünler, gerekçe, geri verilen komisyon ve KDV payı, payı mahsup eden fatura (`docs/MUTABAKAT.md`, "Kısmi iade"). |
| `payments` | Sağlayıcı (PSP, POS veya yemek kartı kuruluşu), yöntem, durum, PSP'nin bildirdiği kesinti, iade tutarı, tahsil anındaki ödeme modu, kullanılan kayıtlı kart, kapıda tahsil eden kişi. Siparişin yerleştirme anındaki niyeti `orders.paymentMethod` / `paymentProvider` alanlarındadır. |
| `meal_card_connections` | Restoranın kabul ettiği yemek kartı kuruluşları (`docs/YEMEK_KARTI.md`): kapıda ve/veya çevrim içi; çevrim içi için şifreli API bilgileri, doğrulama durumu, maskeli etiket. (`restaurantId`, `providerCode`) benzersiz. |
| `payment_provider_connections` | Restoranın kendi sanal POS'u: sağlayıcı kodu, AES-256-GCM ile şifreli bilgiler, anahtar sürümü, doğrulama durumu, maskeli etiket. Restoran başına tek. |
| `saved_payment_methods` | Müşterinin kasa token'ı (şifreli) ve maskeli kart bilgisi; (`userId`, `provider`, `tokenHash`) benzersiz. Kart numarası yoktur. |
| `commission_invoices` | `OWN_POS` restoranının aylık komisyon faturası: dönem, matrah, komisyon, KDV, toplam, durum, vade, ödeme referansı. |
| `ledger_entries` | Yalnızca ekleme; restoran bakış açısıyla işaretli tutar; tür `LedgerEntryType`. |
| `payouts` | Dönem, tutar, durum, planlanan tarih (yasal sürede). |

## Plan ve krediler

| Tablo | Not |
|---|---|
| `plans` | `code` BASIC/PRO; fiyat ve deneme süresi veri. |
| `restaurant_subscriptions` | Restoran başına tek; durum, deneme bitişi, dönem sonu. |
| `message_credit_packages` | Kanal, kredi, fiyat. |
| `message_wallets`, `message_transactions` | Kanal başına bakiye; her hareket bakiye sonrası değeriyle. |
| `push_devices` | Kişinin telefonu: Expo push jetonu (benzersiz), platform, dil, son görülme, `disabledAt` (sağlayıcı cihazı ölü bildirince). Kullanıcıya bağlıdır, restorana değil. |
| `message_logs` | Her deneme; `creditsCharged` yalnızca SENT'te sıfırdan büyük. Telefon maskeli. |

## Kurye

| Tablo | Not |
|---|---|
| `courier_providers` | Adaptör kodu, ülke. |
| `delivery_requests` | Sipariş başına tek; teklif ve nihai ücret, sağlayıcı referansı, takip adresi, ETA. |
| `delivery_trips` | Restoranın kendi kuryesinin bir çıkışı: şube, kurye üyeliği, durum (`DeliveryTripStatus`), sıra modu (MANUAL / OPTIMIZED), planlanan mesafe ve süre, zaman damgaları. |
| `delivery_stops` | Seferdeki bir sipariş: sıra, durum (`DeliveryStopStatus`), hedef koordinat anlık görüntüsü, mesafe ve ETA, varış / teslim / başarısızlık zamanı ve gerekçesi. Bir sipariş aynı anda en fazla bir aktif seferde olur (servis denetler). |
| `courier_locations` | Kuryenin son konumu, üyelik başına tek satır; yalnızca aktif seferde yazılır. |
| `courier_location_samples` | Seferin seyreltilmiş izi (en az 20 m veya 15 sn aralıkla), yalnızca ekleme. |

Sevk ayarları `restaurants.dispatchSettings` JSON alanındadır (`DispatchSettingsSchema`).

## Uyum ve platform

`document_versions`, `consents`, `feature_flags` (GLOBAL veya RESTAURANT kapsamı), `audit_logs`.

## Migration kuralları

Yalnızca ileri yönlü; deploy'dan önce çalışır; bir sürüm boyunca geriye dönük uyumlu (önce genişlet, sonra daralt). CI, boş Postgres'e uygulayıp şema ile sapma olmadığını denetler. Yeni migration: `pnpm --filter @resget/database db:migrate --name <ad>` (yerel Postgres gerekir).
