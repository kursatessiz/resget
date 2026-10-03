/** API access for PRO restaurants (/panel/<slug>/entegrasyon). */
export const trIntegrations = {
  'integrations.title': 'API erişimi',
  'integrations.intro':
    'Kendi yazılımınız (kasa, ERP, web sitesi) siparişlerinizi ve menünüzü bir API anahtarıyla okuyup yönetebilir. Anahtar yalnızca seçtiğiniz yetkileri taşır ve her an iptal edilebilir.',
  'integrations.proRequired': 'API erişimi Pro planında yer alır. Plan düşerse anahtarlar çalışmaz ama silinmez.',
  'integrations.howto.title': 'Nasıl kullanılır',
  'integrations.howto.base': 'Temel adres: {url}',
  'integrations.howto.header':
    'Her isteğe {header} başlığıyla anahtarı ekleyin; panelin kullandığı uçlar aynı biçimde çalışır.',
  'integrations.howto.docs': 'Uç listesi ve örnekler: docs/API_ERISIMI.md; geliştirme ortamında /api/docs.',
  'integrations.new.title': 'Yeni anahtar',
  'integrations.new.name': 'Anahtar adı (örneğin Kasa yazılımı)',
  'integrations.new.permissions': 'Yetkiler',
  'integrations.new.create': 'Anahtar oluştur',
  'integrations.new.created': 'Anahtar oluşturuldu. Bu değer bir daha gösterilmez; şimdi kopyalayın.',
  'integrations.new.token': 'Anahtar',
  'integrations.list.title': 'Anahtarlar',
  'integrations.list.empty': 'Henüz anahtar yok.',
  'integrations.list.keyId': 'Kimlik: {keyId}',
  'integrations.list.createdBy': '{name} oluşturdu, {date}',
  'integrations.list.lastUsed': 'Son kullanım: {date}',
  'integrations.list.neverUsed': 'Henüz kullanılmadı',
  'integrations.list.revoked': 'İptal edildi',
  'integrations.list.active': 'Etkin',
  'integrations.list.revoke': 'İptal et',
  'integrations.list.revokedNotice': 'Anahtar iptal edildi; kullanan sistemler artık 401 alır.',
} as const satisfies Record<string, string>;
