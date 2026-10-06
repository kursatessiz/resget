import { z } from 'zod';
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
