import type { trIntegrations } from '../tr/integrations';

export const enIntegrations: Record<keyof typeof trIntegrations, string> = {
  'integrations.title': 'API access',
  'integrations.intro':
    'Your own software (POS, ERP, website) can read and manage your orders and menu with an API key. A key carries only the permissions you pick and can be revoked at any time.',
  'integrations.proRequired':
    'API access is part of the Pro plan. If the plan lapses, keys stop working but are not deleted.',
  'integrations.howto.title': 'How to use it',
  'integrations.howto.base': 'Base URL: {url}',
  'integrations.howto.header':
    'Send the key in the {header} header on every request; the endpoints the panel uses work the same way.',
  'integrations.howto.docs': 'Endpoint list and examples: docs/API_ERISIMI.md; /api/docs in development.',
  'integrations.new.title': 'New key',
  'integrations.new.name': 'Key name (for example POS software)',
  'integrations.new.permissions': 'Permissions',
  'integrations.new.create': 'Create key',
  'integrations.new.created': 'Key created. This value is never shown again; copy it now.',
  'integrations.new.token': 'Key',
  'integrations.list.title': 'Keys',
  'integrations.list.empty': 'No keys yet.',
  'integrations.list.keyId': 'Id: {keyId}',
  'integrations.list.createdBy': 'Created by {name}, {date}',
  'integrations.list.lastUsed': 'Last used: {date}',
  'integrations.list.neverUsed': 'Not used yet',
  'integrations.list.revoked': 'Revoked',
  'integrations.list.active': 'Active',
  'integrations.list.revoke': 'Revoke',
  'integrations.list.revokedNotice': 'Key revoked; systems using it now get 401.',
};
