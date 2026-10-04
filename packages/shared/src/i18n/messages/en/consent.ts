import type { trConsent } from '../tr/consent';

export const enConsent: Record<keyof typeof trConsent, string> = {
  'consent.checkout.title': 'Campaign and discount messages (optional)',
  'consent.checkout.SMS': 'I want to hear about them by SMS.',
  'consent.checkout.WHATSAPP': 'I want to hear about them on WhatsApp.',

  'consent.channel.SMS': 'SMS',
  'consent.channel.WHATSAPP': 'WhatsApp',
  'consent.channel.EMAIL': 'E-mail',
  'consent.channel.CALL': 'Call',
  'consent.state.active': 'Valid',
  'consent.state.none': 'No decision',
  'consent.state.refused': 'Refused',
  'consent.state.pending': 'Awaiting confirmation',
  'consent.state.inactive': 'Not valid',
  'consent.state.granted': 'Consented',
  'consent.basis.CONSENT': 'Explicit consent',
  'consent.basis.TR_MERCHANT_EXEMPTION': 'Merchant exemption',
  'consent.source.LEGACY': 'Earlier consent box',
  'consent.source.ORDER_CHECKBOX': 'While ordering',
  'consent.source.SITE_FORM': 'Site form',
  'consent.source.CONFIRMATION_LINK': 'Confirmation link',
  'consent.source.OPT_OUT_LINK': 'Opt-out link',
  'consent.source.STAFF_OPT_OUT': 'Recorded by staff',
  'consent.source.MERCHANT_EXEMPTION': 'Merchant exemption',
  'consent.source.ACCOUNT_DELETED': 'Account deleted',
  'consent.region.EU_UK': 'EU, EEA, United Kingdom, Switzerland',
  'consent.region.TR': 'Turkey',
  'consent.region.NANP': 'United States and Canada',
  'consent.region.OTHER': 'Other',

  'consent.card.title': 'Commercial message consent',
  'consent.card.region': 'Region: {region}',
  'consent.card.business': 'Business',
  'consent.card.registrySynced': 'Registered with IYS',
  'consent.card.markBusiness': 'This contact is a business (merchant or tradesperson)',
  'consent.card.history.one': 'Full history ({count} entry)',
  'consent.card.history.other': 'Full history ({count} entries)',
  'consent.optOut.title': 'Record an opt-out',
  'consent.optOut.help':
    'Record it when the customer told you they do not want messages. Only the customer can give consent.',
  'consent.optOut.note': 'How did they tell you? (e.g. on the phone)',
  'consent.optOut.submit': 'Record opt-out',

  'consent.limits.title': 'Sending limits',
  'consent.limits.intro':
    'The most campaign messages one customer gets per day and per week. A customer at the limit is skipped in that campaign.',
  'consent.limits.daily': 'At most per day',
  'consent.limits.weekly': 'At most per week',
  'consent.limits.save': 'Save',
  'consent.limits.saved': 'Limits saved.',

  'consent.confirm.title': 'Confirm your consent',
  'consent.confirm.intro': 'Press the button below to confirm that you want campaign and discount messages.',
  'consent.confirm.button': 'I confirm',
  'consent.confirm.done':
    'Your consent for {restaurant} is confirmed. You can opt out any time with the link in each message.',
  'consent.confirm.invalid': 'This link is not valid or has expired.',

  'consent.policy.title': 'Commercial message consent rules',
  'consent.policy.intro':
    'A new consent from a number in a double opt-in region counts only once the confirmation link sent by SMS is pressed.',
  'consent.policy.moduleOff': 'The consent v2 module is off for this tenant; the rules apply once it is on.',
  'consent.policy.doubleOptIn': 'Regions that need double opt-in',
  'consent.policy.exemption': 'Turkish merchant and tradesperson exemption',
  'consent.policy.exemptionHelp':
    'When on, business contacts in Turkey may get commercial messages by SMS, call and e-mail without prior consent; they are registered with IYS as merchants and can always refuse. WhatsApp is not covered.',
  'consent.policy.save': 'Save',
  'consent.policy.saved': 'Rules saved.',
};
