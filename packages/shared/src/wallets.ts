import { z } from 'zod';
import { stripTrailingSlashes } from './validators';
import type { CardVaultProviderCode, SavedPaymentMethodDTO } from './payments';

/**
 * Platform wallets (docs/CUZDAN.md, module platform_wallets): Masterpass and
 * bex, linked once by the customer and charged at the platform's own
 * merchant, so only restaurants the platform collects for accept them.
 * Wallet names are brands and are not translated.
 */
export const WALLET_PROVIDERS = ['MASTERPASS', 'BEX'] as const satisfies readonly CardVaultProviderCode[];
export type WalletProviderCode = (typeof WALLET_PROVIDERS)[number];

export const WALLET_NAMES: Record<WalletProviderCode, string> = {
  MASTERPASS: 'Masterpass',
  BEX: 'bex',
};

export function isWalletProvider(code: string): code is WalletProviderCode {
  return (WALLET_PROVIDERS as readonly string[]).includes(code);
}

export const WalletProviderSchema = z.enum(WALLET_PROVIDERS);

export const LinkWalletSchema = z.object({ returnUrl: z.string().url() }).strict();
export type LinkWalletInput = z.infer<typeof LinkWalletSchema>;

export const CompleteWalletLinkSchema = z
  .object({ payload: z.record(z.string().max(64), z.string().max(4096)) })
  .strict();
export type CompleteWalletLinkInput = z.infer<typeof CompleteWalletLinkSchema>;

export interface WalletDTO {
  code: WalletProviderCode;
  name: string;
}

/** The account's wallet card: the wallets the platform offers and the customer's cards from them. */
export interface WalletsDTO {
  wallets: WalletDTO[];
  cards: SavedPaymentMethodDTO[];
}

export interface WalletLinkStartDTO {
  redirectUrl: string | null;
  clientParams: Record<string, string>;
}

/** The app's own URL scheme; it must match `scheme` in apps/mobile/app.json. */
export const APP_URL_SCHEME = 'resget';

/**
 * Where a wallet sends the customer back after linking from the app
 * (docs/CUZDAN.md, "Mobil uygulama"): a universal link on the web host that
 * the app claims, with a web fallback page that reopens the app by scheme.
 */
export const APP_WALLET_RETURN_PATH = '/uygulama/cuzdan';

export function appWalletReturnUrl(webBaseUrl: string, code: WalletProviderCode): string {
  return `${stripTrailingSlashes(webBaseUrl)}${APP_WALLET_RETURN_PATH}/${code}`;
}

/** The same return address on the app's scheme, used when the browser kept the universal link. */
export function appWalletReturnSchemeUrl(code: WalletProviderCode, query: string): string {
  const search = query && !query.startsWith('?') ? `?${query}` : query;
  return `${APP_URL_SCHEME}:/${APP_WALLET_RETURN_PATH}/${code}${search}`;
}

/**
 * What the wallet put on the return address, as the link completion payload:
 * single string values only, the route's own `code` dropped, and anything
 * the completion schema would refuse left out.
 */
export function walletLinkPayload(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === 'code' || typeof value !== 'string') continue;
    if (key.length === 0 || key.length > 64 || value.length > 4096) continue;
    payload[key] = value;
  }
  return payload;
}
