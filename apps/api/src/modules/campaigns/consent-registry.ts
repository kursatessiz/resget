import type { ConsentRegistryAdapter, RegistryChannel, RegistryConsentRecord } from '@resget/shared';

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

  /** Registration is a no-op until the real registry is contracted; the decision is still marked synced. */
  async record(_entry: RegistryConsentRecord): Promise<void> {
    return;
  }
}

/**
 * The registry in production before the real adapter is contracted (Turkey: IYS). Covered channels are never
 * cleared, so no commercial message reaches a number the authority has not confirmed (the runner records
 * CONSENT_REGISTRY), and every decision stays unsynced so the real adapter registers the backlog on its first
 * pass (ConsentSyncWatchdog). Uncovered channels and countries are not asked and are unaffected.
 */
export class UnavailableConsentRegistry implements ConsentRegistryAdapter {
  readonly code = 'NONE';

  async allowed(): Promise<Set<string>> {
    return new Set();
  }

  async record(): Promise<void> {
    throw new Error('No consent registry is connected yet');
  }
}
