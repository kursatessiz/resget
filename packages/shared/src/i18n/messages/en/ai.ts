import type { trAi } from '../tr/ai';

export const enAi: Record<keyof typeof trAi, string> = {
  'ai.notice':
    'The AI only drafts: the draft you pick fills the form, and nothing is saved or sent until you edit and save it yourself.',
  'ai.briefHelp':
    'Do not type customer names, phone numbers or email addresses; phone, email and card numbers are removed before anything is sent.',
  'ai.tone': 'Tone',
  'ai.tone.FRIENDLY': 'Friendly',
  'ai.tone.FORMAL': 'Formal',
  'ai.tone.PLAYFUL': 'Playful',
  'ai.generate': 'Write drafts',
  'ai.working': 'Writing...',
  'ai.use': 'Use this draft',
  'ai.length.one': '{count} character',
  'ai.length.other': '{count} characters',
  'ai.redacted.one': '{count} piece of personal data was removed from the description and not sent.',
  'ai.redacted.other': '{count} pieces of personal data were removed from the description and not sent.',
  'ai.budget': 'AI budget left this month: {remaining} of {limit} tokens',
  'ai.campaign.title': 'Draft with AI',
  'ai.campaign.brief': 'What should the message say?',
  'ai.menu.title': 'Description ideas from AI',
  'ai.menu.notes': 'What should it mention? (ingredients, portion, how it is made)',
  'ai.menu.notesHelp': 'Only what you write here is used; allergen and diet information is yours to add.',
  'ai.admin.title': 'AI budget',
  'ai.admin.intro':
    'How many tokens (input and output together) the business may spend in the AI studio per month. Separate from message credits; 0 stops the studio for this business.',
  'ai.admin.limit': 'Monthly token limit',
  'ai.admin.used': 'Used this month: {used}, left: {remaining}',
  'ai.admin.save': 'Save budget',
  'ai.admin.saved': 'Budget saved.',
  'ai.admin.invalid': 'The budget must be a whole number of 0 or more.',
} as const;
