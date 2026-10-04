/** Commercial message consent: checkout boxes, contact card, caps, confirmation page, console policy (docs/RIZA.md). */
export const trConsent = {
  'consent.checkout.title': 'Kampanya ve indirim mesajları (isteğe bağlı)',
  'consent.checkout.SMS': 'SMS ile haberdar olmak istiyorum.',
  'consent.checkout.WHATSAPP': 'WhatsApp ile haberdar olmak istiyorum.',

  'consent.channel.SMS': 'SMS',
  'consent.channel.WHATSAPP': 'WhatsApp',
  'consent.channel.EMAIL': 'E-posta',
  'consent.channel.CALL': 'Arama',
  'consent.state.active': 'Geçerli',
  'consent.state.none': 'Karar yok',
  'consent.state.refused': 'Reddetti',
  'consent.state.pending': 'Onay bekliyor',
  'consent.state.inactive': 'Geçerli değil',
  'consent.state.granted': 'İzin verdi',
  'consent.basis.CONSENT': 'Açık izin',
  'consent.basis.TR_MERCHANT_EXEMPTION': 'Tacir muafiyeti',
  'consent.source.LEGACY': 'Önceki izin kutusu',
  'consent.source.ORDER_CHECKBOX': 'Sipariş sırasında',
  'consent.source.SITE_FORM': 'Site formu',
  'consent.source.CONFIRMATION_LINK': 'Onay bağlantısı',
  'consent.source.OPT_OUT_LINK': 'Vazgeçme bağlantısı',
  'consent.source.STAFF_OPT_OUT': 'Personel kaydı',
  'consent.source.MERCHANT_EXEMPTION': 'Tacir muafiyeti',
  'consent.source.ACCOUNT_DELETED': 'Hesap silindi',
  'consent.region.EU_UK': 'AB, AEA, Birleşik Krallık, İsviçre',
  'consent.region.TR': 'Türkiye',
  'consent.region.NANP': 'ABD ve Kanada',
  'consent.region.OTHER': 'Diğer',

  'consent.card.title': 'Ticari ileti izni',
  'consent.card.region': 'Bölge: {region}',
  'consent.card.business': 'İşletme',
  'consent.card.registrySynced': 'İYS kaydı yapıldı',
  'consent.card.markBusiness': 'Bu kişi bir işletme (tacir veya esnaf)',
  'consent.card.history.one': 'Tüm geçmiş ({count} kayıt)',
  'consent.card.history.other': 'Tüm geçmiş ({count} kayıt)',
  'consent.optOut.title': 'Vazgeçme kaydet',
  'consent.optOut.help':
    'Müşteri size mesaj almak istemediğini söylediyse kaydedin. İzni yalnızca müşterinin kendisi verebilir.',
  'consent.optOut.note': 'Nasıl iletti? (ör. telefonda söyledi)',
  'consent.optOut.submit': 'Vazgeçmeyi kaydet',

  'consent.limits.title': 'Gönderim sınırları',
  'consent.limits.intro':
    'Bir müşteriye günde ve haftada en fazla kaç kampanya mesajı gideceği. Sınıra takılan müşteri o kampanyada atlanır.',
  'consent.limits.daily': 'Günlük en fazla',
  'consent.limits.weekly': 'Haftalık en fazla',
  'consent.limits.save': 'Kaydet',
  'consent.limits.saved': 'Sınırlar kaydedildi.',

  'consent.confirm.title': 'İzninizi onaylayın',
  'consent.confirm.intro':
    'Kampanya ve indirim mesajları almak için verdiğiniz izni onaylamak üzere aşağıdaki düğmeye basın.',
  'consent.confirm.button': 'Onaylıyorum',
  'consent.confirm.done':
    '{restaurant} için izniniz onaylandı. Her mesajdaki bağlantıyla istediğiniz zaman vazgeçebilirsiniz.',
  'consent.confirm.invalid': 'Bu bağlantı geçerli değil veya süresi dolmuş.',

  'consent.policy.title': 'Ticari ileti izni kuralları',
  'consent.policy.intro':
    'Çift onay istenen bölgelerdeki numaralardan gelen yeni izin, SMS ile gönderilen onay bağlantısına basılana kadar sayılmaz.',
  'consent.policy.moduleOff': 'Rıza v2 modülü bu kiracıda kapalı; kurallar modül açılınca uygulanır.',
  'consent.policy.doubleOptIn': 'Çift onay istenen bölgeler',
  'consent.policy.exemption': 'Türkiye tacir ve esnaf muafiyeti',
  'consent.policy.exemptionHelp':
    "Açıkken işletme olarak işaretli Türkiye kişilerine SMS, arama ve e-postayla önceden izin olmadan ticari ileti gidebilir; kişi İYS'ye tacir olarak kaydedilir ve her zaman reddedebilir. WhatsApp bu muafiyete dahil değildir.",
  'consent.policy.save': 'Kaydet',
  'consent.policy.saved': 'Kurallar kaydedildi.',
} as const;
