import { z } from 'zod';

/**
 * Integration hub (docs/ENTEGRASYON_MERKEZI.md). Social accounts are
 * connected with OAuth, never by pasting a token: the business is sent to
 * the provider's consent screen and back, and the API stores the page tokens
 * it receives, encrypted. Meta (Facebook pages and their Instagram business
 * accounts) comes first; Lead Ads and social publishing build on these
 * connections.
 */

export const SOCIAL_PROVIDERS = ['META'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const SOCIAL_ACCOUNT_KINDS = ['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS'] as const;
export type SocialAccountKind = (typeof SOCIAL_ACCOUNT_KINDS)[number];

export const SOCIAL_ACCOUNT_STATUSES = ['ACTIVE', 'EXPIRED'] as const;
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

/**
 * Permissions asked of Meta: list and read the pages, publish to them and to
 * their Instagram accounts, read Lead Ads leads. App Review must grant each
 * one before live use (docs/ENTEGRASYON_MERKEZI.md).
 */
export const META_OAUTH_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_manage_posts',
  'leads_retrieval',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
] as const;

/** How long a consent round trip may take before its state is refused. */
export const OAUTH_STATE_TTL_MINUTES = 10;

/** Where the business comes back to after the consent screen; only these screens, never an outside address. */
export const OAUTH_RETURN_PATH_PATTERN = /^\/(panel\/[a-z0-9-]{2,60}\/entegrasyon|pazarlama\/entegrasyonlar)$/;

export const StartMetaConnectSchema = z
  .object({ returnPath: z.string().regex(OAUTH_RETURN_PATH_PATTERN, 'return path') })
  .strict();
export type StartMetaConnectInput = z.infer<typeof StartMetaConnectSchema>;

export interface OAuthStartDTO {
  authorizeUrl: string;
}

export const UpdateSocialAccountSchema = z.object({ enabled: z.boolean() }).strict();
export type UpdateSocialAccountInput = z.infer<typeof UpdateSocialAccountSchema>;

export interface SocialAccountDTO {
  id: string;
  provider: SocialProvider;
  kind: SocialAccountKind;
  /** The account's id at the provider (page id, Instagram user id). */
  externalId: string;
  name: string;
  /** Only enabled accounts are used for publishing and leads. */
  enabled: boolean;
  status: SocialAccountStatus;
  scopes: string[];
  connectedAt: string;
  tokenExpiresAt: string | null;
}

/** Outcome of the consent round trip, as the screen reads it from the query string. */
export const OAUTH_RESULTS = ['connected', 'denied', 'error'] as const;
export type OAuthResult = (typeof OAUTH_RESULTS)[number];
