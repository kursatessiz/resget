import type { trOrderingLinks } from '../tr/orderingLinks';

export const enOrderingLinks: Record<keyof typeof trOrderingLinks, string> = {
  'orderingLinks.title': 'Ordering links',
  'orderingLinks.intro':
    'A separate link to your ordering page for each channel. Paste each link where it belongs; orders that come through it are counted here and show the channel on the order card. No cookies or visitor tracking are used for this.',
  'orderingLinks.source.INSTAGRAM': 'Instagram',
  'orderingLinks.source.FACEBOOK': 'Facebook',
  'orderingLinks.source.WHATSAPP': 'WhatsApp',
  'orderingLinks.source.GOOGLE': 'Google',
  'orderingLinks.source.TIKTOK': 'TikTok',
  'orderingLinks.where.INSTAGRAM':
    'Add it to the links section of your profile; you can also share it in stories with a link sticker.',
  'orderingLinks.where.FACEBOOK': "Add it to your page's action button (order now) and to your posts.",
  'orderingLinks.where.WHATSAPP':
    'Add it to your WhatsApp Business greeting and away messages, the website field of your profile or a status update.',
  'orderingLinks.where.GOOGLE':
    'Add it in the food ordering section of your Google Business Profile as the delivery and pickup link.',
  'orderingLinks.where.TIKTOK': 'Add it to the profile link of your TikTok business account.',
  'orderingLinks.copy': 'Copy link',
  'orderingLinks.copied': 'Copied',
  'orderingLinks.copyFailed': 'Could not copy; select the link and copy it by hand.',
  'orderingLinks.link': '{source} link',
  'orderingLinks.stats.one': '{count} order in the last {days} days, {amount}',
  'orderingLinks.stats.other': '{count} orders in the last {days} days, {amount}',
  'orderingLinks.other.one': 'In the same period {count} more order reached your ordering page without a link.',
  'orderingLinks.other.other': 'In the same period {count} more orders reached your ordering page without a link.',
  'orderingLinks.base': 'The links lead to: {url}',
  'orderingLinks.loadError': 'The links could not be loaded.',
};
