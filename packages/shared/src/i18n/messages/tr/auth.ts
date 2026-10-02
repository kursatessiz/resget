export const trAuth = {
  'auth.phone.label': 'Telefon numarası',
  'auth.phone.help': 'Size SMS ile tek kullanımlık bir kod göndereceğiz.',
  'auth.otp.send': 'Kod gönder',
  'auth.otp.label': 'Doğrulama kodu',
  'auth.otp.verify': 'Doğrula ve giriş yap',
  'auth.otp.resend': 'Kodu yeniden gönder',
  'auth.otp.sent': 'Kod gönderildi. Birkaç saniye içinde ulaşır.',
  'auth.otp.invalid': 'Kod hatalı veya süresi dolmuş.',
  'auth.otp.tooMany': 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.',
  'auth.consent.required': 'Devam etmek için kullanım koşullarını ve aydınlatma metnini kabul edin.',
  'auth.noMembership': 'Bu numaraya bağlı bir işletme yok. Davet bağlantınızı kullanın.',
} as const satisfies Record<string, string>;
