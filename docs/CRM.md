# CRM çekirdeği

Restoranın müşteri listesi, aşamalı satış hattı olan bir kişi listesine dönüşür. Platform kiracısında kişiler restoran sahipleri ve adaylardır (`docs/PAZARLAMA.md`); restoranlarda toplu sipariş, kurumsal hesap ve catering adaylarıdır. `contacts_crm` modül anahtarının arkasındadır (varsayılan kapalı); okumak açık, yazmak PRO `crm` özelliğidir.

## Model

- **Kişi** = `RestaurantCustomer`. Ayrı bir kişi tablosu yoktur; müşteriyle aday aynı satırdır. Hiç sipariş vermemiş aday için `firstChannel` boştur. Telefon kullanıcıdadır (küresel, telefonla tekil), böylece aynı numara bir kiracıda iki kişi olamaz (`CONTACT_EXISTS`). CRM alanları: e-posta, işletme, il, ilçe, kaynak, aşama, sorumlu (aktif üyelik), son etkinlik zamanı.
- **Aşama** (`PipelineStage`): kiracı verisidir; ilk kullanımda kiracı türüne göre varsayılanlar oluşturulur. Platform: aday, iletişime geçildi, demo, kurulum, canlı (kazanıldı), kaybedildi. Restoran: yeni, iletişime geçildi, kazanıldı, kaybedildi. Varsayılan aşamaların adı i18n'den (`crm.stage.<key>`), özel aşamanın adı kiracıdan gelir.
- **Etkinlik** (`ContactActivity`, yalnızca ekleme): not, arama, görüşme, e-posta (elle); aşama değişikliği ve tamamlanan görev (sistem). Her kayıt kişinin son etkinlik zamanını günceller.
- **Görev** (`ContactTask`): başlık, son tarih, atanan üye; tamamlanınca geçmişe "görev tamamlandı" yazılır.

## Uçlar (`/restaurants/:id/crm`)

- `GET pipeline` (`customers.view`): aşamalar, aşama başına en fazla 100 kişi (son etkinliğe göre), aşamasız adaylar (`none`) ve sorumlu olabilecek üyeler.
- `POST contacts` (`customers.manage`, PRO): aday ekle `{ fullName, phone, email?, company?, city?, district?, source?, stageId?, tags? }`.
- `GET contacts/:customerId`: kişi kartı, son 100 etkinlik ve görevler.
- `PATCH contacts/:customerId`: CRM alanları, aşama (değişiklik geçmişe yazılır) ve sorumlu.
- `POST contacts/:customerId/activities`: `{ type: NOTE | CALL | MEETING | EMAIL, body }`.
- `POST contacts/:customerId/tasks`, `GET tasks?mine=true`, `PATCH tasks/:taskId` `{ done }`.
- `GET export.csv` (`customers.contact.view`): bütün kişiler; başlık satırı sütun anahtarlarıdır, formül karakteriyle başlayan değer etkisizleştirilir (`csvField`). Platformda `platform.contacts.export` bu izne karşılık gelir.

Telefon ve e-posta `customers.contact.view` olmadan maskelenir.

## Ekranlar

- Panel: `/panel/<slug>/satis-hatti` (menüde "Satış hattı", anahtar açıkken): aşama sütunları, kişi kartları, kişi kartında aşama ve sorumlu seçimi, geçmiş ve kayıt ekleme, görevler; altta açık görevler. Kişi taşımak sürükleme değil seçimdir; klavye ve telefonla çalışır.
- Pazarlama alanı: `/pazarlama/satis-hatti` ve `/pazarlama/gorevler`.

## Sonraki adımlar

Kişi birleştirme, özel alanlar, aşama düzenleyici, toplu içe aktarma; ziyaretçi ve atıf verisinin kişiye bağlanması (yol haritası 3. madde).
