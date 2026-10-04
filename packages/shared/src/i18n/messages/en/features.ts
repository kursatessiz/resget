import type { trFeatures } from '../tr/features';

export const enFeatures: Record<keyof typeof trFeatures, string> = {
  'features.marketplace.name': 'Marketplace',
  'features.marketplace.description': 'The business is listed in the district marketplace.',
  'features.table_qr.name': 'Table QR',
  'features.table_qr.description': 'Menu and ordering from the QR code on the table; the tables screen.',
  'features.ratings.name': 'Order ratings',
  'features.ratings.description': 'Customers rate a completed order from the tracking page.',
  'features.missing_item_claims.name': 'Missing item reports',
  'features.missing_item_claims.description':
    'Customers report a missing item and the business approves a partial refund.',
  'features.online_payment.name': 'Online card payment',
  'features.online_payment.description': "Paying online by card (the business's POS connection or the platform PSP).",
  'features.meal_cards.name': 'Meal cards',
  'features.meal_cards.description': 'Paying with meal cards online and at the door; the meal card connections screen.',
  'features.partial_refunds.name': 'Partial refunds',
  'features.partial_refunds.description': 'Refunding chosen items or an amount on a completed order.',
  'features.own_courier_dispatch.name': 'Own courier dispatch',
  'features.own_courier_dispatch.description': 'The dispatch board, trips and the trips in the courier app.',
  'features.courier_network.name': 'Courier network',
  'features.courier_network.description': 'Quotes from a third-party courier network and choosing the network.',
  'features.crm.name': 'Customer notes and tags',
  'features.crm.description': 'Notes and tags on the customer card (PRO).',
  'features.campaigns.name': 'Campaigns',
  'features.campaigns.description': 'SMS and WhatsApp campaigns to customers who opted in (PRO).',
  'features.loyalty.name': 'Loyalty programme',
  'features.loyalty.description': 'Earning and spending points on orders (PRO).',
  'features.whatsapp_channel.name': 'WhatsApp channel',
  'features.whatsapp_channel.description': 'Messages go by WhatsApp; when switched off they go by SMS.',
  'features.custom_domain.name': 'Custom domain',
  'features.custom_domain.description': "The ordering page opens on the business's own domain (PRO).",
  'features.api_access.name': 'API access and webhooks',
  'features.api_access.description': 'API keys and outbound webhooks; keys stop working when switched off (PRO).',
  'features.order_availability.name': 'Order availability',
  'features.order_availability.description': 'Pausing orders, busy mode and refusing orders outside opening hours.',
  'features.delivery_zones.name': 'Delivery zone',
  'features.delivery_zones.description': 'Delivery radius, minimum basket and delivery fee by distance.',
  'features.coupons.name': 'Coupons',
  'features.coupons.description':
    'Discount codes funded by the business: percent or amount, first order, usage limits.',
  'features.claim_escalation.name': 'Claim escalation',
  'features.claim_escalation.description':
    'A missing item report undecided for 24 hours moves to the platform console; repeat-claimant warning.',
  'features.app_order_handling.name': 'Order handling in the app',
  'features.app_order_handling.description':
    'Accept, reject, ready and hand-over steps on the tablet and phone; vibration and a notification for new orders.',
  'features.pos_integration.name': 'POS integration',
  'features.pos_integration.description':
    "New orders go to the business's own POS; automatic acceptance and status updates from the POS.",
  'features.marketing_platform.name': 'Platform marketing',
  'features.marketing_platform.description':
    "The platform tenant, marketing users and the Marketing area for the platform's own marketing.",
  'features.contacts_crm.name': 'CRM and pipeline',
  'features.contacts_crm.description': 'Contacts, a staged pipeline, activity history, tasks and CSV export.',
  'features.attribution.name': 'Visit measurement and attribution',
  'features.attribution.description':
    'Cookie consent banner, visits with UTM and ad click ids, table QR link, conversions and the attribution report; lead form on the platform site.',
};
