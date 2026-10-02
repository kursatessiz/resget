import type { trLanding } from '../tr/landing';

export const enLanding: Record<keyof typeof trLanding, string> = {
  'landing.headline': 'The 1 percent ordering network for restaurants',
  'landing.subheadline':
    'Starts with the QR on the table, grows with delivery orders. Transparent payment cost, courier as a separate service, menu and ordering software for free.',
  'landing.cta.restaurant': 'Register your restaurant',
  'landing.cta.signIn': 'Sign in',
  'landing.pillar.commission.title': '1 percent commission',
  'landing.pillar.commission.body':
    'Only 1 percent per order. The payment provider fee is passed through at its documented real rate.',
  'landing.pillar.qr.title': 'Customer acquisition through table QR',
  'landing.pillar.qr.body': 'The guest who opens your menu at the table finds you for the next delivery order.',
  'landing.pillar.saas.title': 'Free restaurant software',
  'landing.pillar.saas.body': 'Menu, order screen and table QR are free for good. Advanced tools live in the Pro plan.',
  'landing.pillar.courier.title': 'Courier is separate and optional',
  'landing.pillar.courier.body':
    'Work with your own courier or get a quote from a partner courier network. The fee shows as its own line.',
  'landing.footer.platform': 'Resget',
};
