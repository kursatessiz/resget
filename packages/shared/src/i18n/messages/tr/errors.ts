/** Machine-readable API error codes (x-error-code) and what the user sees for each. */
export const trErrors = {
  'errors.VALIDATION': 'Gönderilen bilgiler geçersiz.',
  'errors.UNAUTHORIZED': 'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.',
  'errors.FORBIDDEN': 'Bu işlem için yetkiniz yok.',
  'errors.NOT_FOUND': 'Kayıt bulunamadı.',
  'errors.RESTAURANT_INACTIVE': 'Bu işletme şu anda aktif değil.',
  'errors.MEMBERSHIP_NOT_ACTIVE': 'Bu işletmedeki üyeliğiniz aktif değil.',
  'errors.PLAN_FEATURE_REQUIRED': 'Bu özellik Pro planında yer alır.',
  'errors.INSUFFICIENT_CREDITS': 'Mesaj kredisi yetersiz. Kredi paketi satın alın.',
  'errors.TABLE_NOT_FOUND': 'Bu masa bulunamadı. Lütfen personele danışın.',
  'errors.MENU_UNAVAILABLE': 'Menü şu anda görüntülenemiyor.',
  'errors.COURIER_QUOTE_FAILED': 'Kurye teklifi alınamadı. Lütfen tekrar deneyin.',
  'errors.RATE_LIMITED': 'Çok fazla istek gönderildi. Lütfen biraz bekleyin.',
} as const satisfies Record<string, string>;
