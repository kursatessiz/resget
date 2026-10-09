import type {
  CardVaultAdapter,
  CardVaultProviderCode,
  SavedCardMetadata,
  VaultChargeRequest,
  VaultChargeResult,
} from '@resget/shared';
import { conflict } from '../../common/api-error';

/**
 * The card vault in production before a vault contract exists (docs/ODEME.md 3): no card can be linked or
 * charged, so nothing "succeeds" without money. Invoices are paid by bank transfer meanwhile. The real adapter
 * (CARD_VAULT_PROVIDER) is registered in PaymentsRegistry and replaces this with no other change.
 */
export class UnavailableVaultAdapter implements CardVaultAdapter {
  readonly crossMerchant = false;

  constructor(readonly code: CardVaultProviderCode) {}

  async beginLink(): Promise<{ redirectUrl: string | null; clientParams: Record<string, string> }> {
    throw conflict('VAULT_UNAVAILABLE', 'No card vault is connected yet');
  }

  async completeLink(): Promise<Array<SavedCardMetadata & { token: string }>> {
    throw conflict('VAULT_UNAVAILABLE', 'No card vault is connected yet');
  }

  async charge(_request: VaultChargeRequest): Promise<VaultChargeResult> {
    throw conflict('VAULT_UNAVAILABLE', 'No card vault is connected yet');
  }

  /** No token of this vault can exist, so there is nothing to forget. */
  async forget(): Promise<void> {
    return;
  }
}
