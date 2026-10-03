import type { trSignup } from '../tr/signup';

export const enSignup: Record<keyof typeof trSignup, string> = {
  'signup.title': 'Open your restaurant',
  'signup.intro':
    'Enter your menu and print your table QR codes in a few minutes. The Basic plan is free for good; Pro features start with a trial.',
  'signup.business.title': 'Business',
  'signup.name': 'Business name',
  'signup.slug': 'Ordering page address',
  'signup.slugHelp': 'Lowercase letters, digits and dashes only. Left empty, it is derived from the name.',
  'signup.country': 'Country',
  'signup.currency': 'Currency',
  'signup.timezone': 'Time zone',
  'signup.legalName': 'Legal name (optional)',
  'signup.taxId': 'Tax id (optional)',
  'signup.branch.title': 'Branch',
  'signup.branch.name': 'Branch name',
  'signup.branch.addressLine': 'Address',
  'signup.branch.city': 'City',
  'signup.branch.district': 'District',
  'signup.branch.phone': 'Branch phone (optional)',
  'signup.submit': 'Create the restaurant',
  'signup.creating': 'Creating...',
  'signup.terms':
    'By continuing you accept the 1 percent order commission and the terms of use. Marketplace listing starts when the service area launches and the menu is approved.',
  'signup.signedInAs': 'You continue as {name} ({phone}); this number becomes the owner of the restaurant.',
  'signup.success': 'Your restaurant is ready. Taking you to the panel.',
};
