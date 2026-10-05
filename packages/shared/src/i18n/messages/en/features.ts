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
  'features.consent_v2.name': 'Consent v2: consent per channel',
  'features.consent_v2.description':
    'Per-channel consent boxes at checkout, consent history and legal basis, double opt-in for the EU, merchant exemption, sending limits and IYS registration.',
  'features.email_channel.name': 'Email channel',
  'features.email_channel.description':
    'Email from your own domain (SPF, DKIM, DMARC checks), suppression of bounced and complaining addresses, test send.',
  'features.segments_v2.name': 'Segments v2',
  'features.segments_v2.description':
    'Saved segments with an AND / OR rule language, dynamic and static segments, per-channel reach preview, target segment in campaigns.',
  'features.campaigns_v2.name': 'Campaigns v2',
  'features.campaigns_v2.description':
    'Email campaigns, A/B tests, best send hour per recipient, conversions and attributed revenue.',
  'features.journeys.name': 'Automated flows',
  'features.journeys.description':
    'Post-order thank you, first order, review request and win-back messages, under the consent, hour and credit rules.',
  'features.kpi_dashboard.name': 'Funnels and KPI board',
  'features.kpi_dashboard.description':
    'In the marketing area: orders per restaurant per day, table QR and restaurant funnels, channels, revenue and districts.',
  'features.ad_integrations.name': 'Ad integrations',
  'features.ad_integrations.description':
    'Connect Meta, Google Ads and TikTok accounts, send conversions from the server (only with advertising consent), daily spend and return on ad spend report.',
  'features.page_engine.name': 'Page engine and SEO',
  'features.page_engine.description':
    'Block-built pages on the platform site, automatic district pages for launched districts, the sitemap and structured data on restaurant pages.',
  'features.blog.name': 'Blog',
  'features.blog.description':
    'Blog posts on the platform site (/blog) with structured data per post and sitemap entries; the page engine must be on.',
  'features.referrals.name': 'Customer referrals',
  'features.referrals.description':
    "A customer's personal invite code, a first-order discount for the friend and a reward coupon for the referrer; needs the coupons module and the PRO plan.",
  'features.partner_referrals.name': 'Restaurant referrals',
  'features.partner_referrals.description':
    "A restaurant's invite link; PRO time for the new restaurant at sign-up and for the inviter once the new restaurant's orders are completed. Rewards are set in the console; commission does not change.",
  'features.feedback.name': 'Feedback and NPS',
  'features.feedback.description':
    'Follow-up cases and team alerts for low ratings, a review link for every rater, an NPS question on the tracking page and a summary; PRO analytics.',
  'features.churn_signals.name': 'Customer churn risk',
  'features.churn_signals.description':
    'New, regular, did-not-return, at-risk and lost classes against each customer’s own ordering rhythm; a list of customers to win back and a churn risk field in segments; PRO analytics.',
  'features.restaurant_health.name': 'Restaurant health (console)',
  'features.restaurant_health.description':
    'A console list of restaurants with signals such as an order drop, silence, no first order, an overdue invoice, a suspended listing or a trial ending without a card. Opened with the global switch.',
  'features.marketing_approvals.name': 'Send approvals and limits',
  'features.marketing_approvals.description':
    'A campaign is not sent until an authorised person other than the requester approves it; changing the content takes the approval back. Per-campaign and 24-hour recipient limits set in the console apply. Meant for the platform tenant first.',
  'features.audit_viewer.name': 'Audit log (console)',
  'features.audit_viewer.description':
    'Read the audit log in the console with business, action and date filters, plus a quick filter for platform sends. Opened with the global switch.',
  'features.ai_studio.name': 'AI studio',
  'features.ai_studio.description':
    'Drafts of campaign messages and menu descriptions; drafts only, no personal data reaches the model, a monthly token budget separate from message credits. PRO.',
  'features.integration_hub.name': 'Integration hub',
  'features.integration_hub.description':
    "Connect Facebook pages and Instagram business accounts through Meta's consent screen (OAuth); access keys are stored encrypted. Lead Ads and social publishing use these connections.",
  'features.lead_ads.name': 'Lead Ads import',
  'features.lead_ads.description':
    'Leads from Facebook and Instagram ad forms arrive through a signed Meta notification and are added to the sales pipeline as contacts; no marketing consent is assumed. Requires the integration hub.',
  'features.social_publishing.name': 'Social publishing',
  'features.social_publishing.description':
    'Write, schedule and publish posts to connected Facebook pages and Instagram business accounts; each account has its own outcome. Requires the integration hub.',
  'features.scheduled_orders.name': 'Scheduled orders',
  'features.scheduled_orders.description':
    'Customers order now for a later time within the opening hours; pre-orders are taken while the business is closed too. The accept alarm follows when preparation has to start.',
  'features.allergens.name': 'Allergens and dietary tags',
  'features.allergens.description':
    'The 14 regulated allergens and tags such as vegetarian, vegan or gluten free on menu items; shown on the ordering page with a filter that hides items by allergen.',
  'features.attribution.name': 'Visit measurement and attribution',
  'features.attribution.description':
    'Cookie consent banner, visits with UTM and ad click ids, table QR link, conversions and the attribution report; lead form on the platform site.',
};
