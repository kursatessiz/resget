import type { trCampaigns } from '../tr/campaigns';

export const enCampaigns: Record<keyof typeof trCampaigns, string> = {
  'campaigns.title': 'Campaigns',
  'campaigns.intro':
    'SMS and WhatsApp campaigns, segments and loyalty are part of the Pro plan. Sends use message credits and only reach customers who gave marketing consent.',
  'campaigns.proRequired': 'This screen opens with the Pro plan.',
  'campaigns.audience': 'Customers with marketing consent: {count}',
  'campaigns.comingSoon':
    'The campaign tool arrives in the next release. Your customer list and credits are ready now.',
  'campaigns.openCustomers': 'Open the customer list',
  'campaigns.openCredits': 'See credits',
};
