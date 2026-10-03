/** Restaurant self sign-up at /kayit (docs/PLATFORM_YONETIMI.md). */
export const trSignup = {
  'signup.title': 'İşletmenizi açın',
  'signup.intro':
    'Birkaç dakikada menünüzü girip masa QR kodlarınızı yazdırabilirsiniz. Temel plan süresiz ücretsizdir; Pro özellikleri deneme süresiyle açılır.',
  'signup.business.title': 'İşletme',
  'signup.name': 'İşletme adı',
  'signup.slug': 'Sipariş sayfası adresi',
  'signup.slugHelp': 'Yalnızca küçük harf, rakam ve tire. Boş bırakırsanız addan türetilir.',
  'signup.country': 'Ülke',
  'signup.currency': 'Para birimi',
  'signup.timezone': 'Saat dilimi',
  'signup.legalName': 'Ticari unvan (isteğe bağlı)',
  'signup.taxId': 'Vergi numarası (isteğe bağlı)',
  'signup.branch.title': 'Şube',
  'signup.branch.name': 'Şube adı',
  'signup.branch.addressLine': 'Adres',
  'signup.branch.city': 'İl',
  'signup.branch.district': 'İlçe',
  'signup.branch.phone': 'Şube telefonu (isteğe bağlı)',
  'signup.submit': 'İşletmeyi oluştur',
  'signup.creating': 'Oluşturuluyor...',
  'signup.terms':
    'Devam ederek yüzde 1 sipariş komisyonunu ve kullanım koşullarını kabul etmiş olursunuz. Pazaryerinde listelenme, hizmet alanı açıldığında ve menü onaylandığında başlar.',
  'signup.signedInAs': '{name} ({phone}) olarak devam ediyorsunuz; işletmenin sahibi bu numara olur.',
  'signup.success': 'İşletmeniz hazır. Panele yönlendiriliyorsunuz.',
} as const satisfies Record<string, string>;
