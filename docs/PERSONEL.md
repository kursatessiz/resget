# Personel, davet ve roller

Kullanıcılar globaldir ve telefon numarasıyla tanımlanır; bir restorana bağ `Membership` üzerinden kurulur (CLAUDE.md kural 6). Personel eklemek, bir telefon numarasını bir role davet etmektir; kişi kendi numarasını doğruladığında üyelik oluşur. Yetkilendirme sabit rollere değil izinlere dayanır: her rol şablonu izin kataloğunun bir alt kümesidir (`packages/shared/src/permissions.ts`), menüler ve ekranlar kişinin etkin izinlerinden çizilir.

## Akış

1. Yetkili (`staff.manage`) panelde ad, telefon ve rol girer (`POST /restaurants/:id/staff/invites`). Sahip rolü davet edilemez (`ROLE_PROTECTED`); numara zaten aktif üyeyse davet açılmaz (`STAFF_ALREADY_MEMBER`). Aynı numaraya açık önceki davetler geçersiz olur; bir numara için tek geçerli bağlantı vardır.
2. `InviteToken` 72 saat geçerlidir (`INVITE_TTL_HOURS`), 24 rastgele bayt base64url. Kanal `SHOWN` ise panel bağlantıyı ve QR kodunu (`GET .../invites/:inviteId/qr.png`) gösterir; `SMS` ise mesaj restoranın dilinde `staff.invite.sms` şablonuyla gider. Davet SMS'i OTP gibi platform trafiğidir, restoranın mesaj cüzdanından düşmez. WhatsApp kanalı mesajlaşma motoruyla (A7) gelir.
3. Kişi `https://<web>/j/<token>` adresini açar. Sayfa `GET /public/invites/:token` ile restoran adını, rolü, davet edilen adı ve maskeli telefonu gösterir; kimlik veya bilgi taşımaz.
   - Oturum yoksa `/giris?davet=<token>` adresine gider. `POST /auth/otp/verify` isteği `inviteToken` taşır; kod doğrulanınca `InviteAcceptanceService.accept()` çalışır ve üyelik aynı adımda açılır.
   - Oturum varsa (örneğin başka bir restoranın personeli) tek tıkla kabul eder: `POST /me/invites/:token/accept`.
4. Kabul koşulları: davet kullanılmamış (`INVITE_USED`) ve süresi geçmemiş (`INVITE_EXPIRED`) olmalı; giriş yapan numara davetin numarasıyla aynı olmalı (`INVITE_PHONE_MISMATCH`). Üyelik `ACTIVE` olur (`PASSIVE` bir üyelik yeniden açılır), `joinedAt` yazılır, davet `usedAt` ile kapanır. Yeni bir kullanıcının adı davetteki addır.

## Üyelik yönetimi

- `GET /restaurants/:id/staff` ekibi, bekleyen davetleri ve rolleri verir.
- `PATCH /restaurants/:id/staff/members/:membershipId` rol ve durum (`ACTIVE` / `PASSIVE`) değiştirir. Sahibin üyeliği buradan değiştirilemez (`STAFF_OWNER_PROTECTED`); sahip rolü atanamaz. Panel, kişinin kendi üyeliğini de kilitler.
- `PASSIVE` üyelik her korumalı uçta `MEMBERSHIP_NOT_ACTIVE` ile reddedilir ve `/auth/me` listesinde görünmez; hesap silinmez, erişim yeniden açılabilir.
- `DELETE /restaurants/:id/staff/invites/:inviteId` daveti iptal eder (süresi şimdiye çekilir).

## Roller

- Her restoran `DEFAULT_ROLE_TEMPLATES` ile başlar (sahip, müdür, kasa, mutfak, kurye). Varsayılan şablonlar `templateKey` taşır ve adı `roles.default.<key>` mesajıyla gösterilir; adı ve izinleri sahibin düzenlemesine açıktır. Sahip şablonu değiştirilemez ve silinemez (`ROLE_PROTECTED`).
- `POST / PATCH / DELETE /restaurants/:id/staff/roles` (`roles.manage`). Rol adı restoran içinde benzersizdir (`ROLE_NAME_TAKEN`). Personel veya açık davet kullanan rol silinemez (`ROLE_IN_USE`).
- İzin anahtarları yalnızca katalogdan gelir; bilinmeyen anahtar doğrulamada düşer. Yeni bir izin eklemek geriye uyumludur; anahtar yeniden adlandırmak `role_template_permissions` için migration gerektirir.

## Ekranlar

- `/panel/<slug>/personel` (`staff.manage`): davet formu, bekleyen davetler (bağlantı kopyalama, QR, iptal), ekip listesi (rol seçimi, erişimi kapat / aç).
- `/panel/<slug>/personel/roller` (`roles.manage`): roller ve izin onay kutuları, yeni rol, rol silme.
- `/j/<token>`: herkese açık davet sayfası, restoranın renginde.
