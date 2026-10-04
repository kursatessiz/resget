import type { ConsentRegistryAdapter, RegistryChannel } from '@resget/shared';

export const CONSENT_REGISTRY = Symbol('CONSENT_REGISTRY');

/**
 * Development stand-in for the regional consent registry (Turkey: IYS). It
 * approves every opted-in number; the real adapter, selected by
 * CONSENT_REGISTRY_PROVIDER, asks the authority and returns only the numbers
 * it confirms. The campaign runner treats the rest as SKIPPED.
 */
export class MockConsentRegistry implements ConsentRegistryAdapter {
  readonly code = 'MOCK';

  async allowed(_countryCode: string, _channel: RegistryChannel, phones: readonly string[]): Promise<Set<string>> {
    return new Set(phones);
  }
}
