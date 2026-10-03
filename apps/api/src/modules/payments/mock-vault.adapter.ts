import { randomUUID } from 'node:crypto';
import type { CardVaultAdapter, SavedCardMetadata, VaultChargeRequest, VaultChargeResult } from '@resget/shared';

/**
 * In-memory card vault for development and tests. Linking "succeeds" with
 * one fake card per user; a Masterpass adapter implements the same interface
 * with the real linking (phone number and OTP in Masterpass's own UI) and
 * cross-merchant charging.
 */
export class MockVaultAdapter implements CardVaultAdapter {
  readonly code = 'MOCK' as const;
  readonly crossMerchant = true;

  async beginLink(
    userRef: string,
    returnUrl: string,
  ): Promise<{ redirectUrl: string | null; clientParams: Record<string, string> }> {
    return { redirectUrl: `${returnUrl}?mockLink=${encodeURIComponent(userRef)}`, clientParams: { userRef } };
  }

  async completeLink(userRef: string): Promise<Array<SavedCardMetadata & { token: string }>> {
    return [
      {
        token: `mock-card-${userRef}`,
        brand: 'Mastercard',
        last4: '4242',
        expiryMonth: 12,
        expiryYear: 2030,
        label: 'Test kart',
      },
    ];
  }

  async charge(request: VaultChargeRequest): Promise<VaultChargeResult> {
    if (request.amountMinor <= 0)
      return { status: 'FAILED', providerRef: null, redirectUrl: null, failureCode: 'INVALID_AMOUNT' };
    return { status: 'CAPTURED', providerRef: `mock-charge-${randomUUID()}`, redirectUrl: null, failureCode: null };
  }

  async forget(): Promise<void> {
    return;
  }
}
