import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ConsentRegistryAdapter, InvoiceProviderAdapter } from '@resget/shared';
import { UnavailableInvoiceProvider } from '../../modules/billing/invoice-provider';
import { MockConsentRegistry, UnavailableConsentRegistry } from '../../modules/campaigns/consent-registry';
import { CourierRegistry } from '../../modules/courier/courier.registry';
import { PaymentsRegistry } from '../../modules/payments/payments.registry';
import { MealCardsRegistry } from '../../modules/payments/meal-cards.registry';

function configFor(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const production = configFor({
  NODE_ENV: 'production',
  CARD_VAULT_PROVIDER: 'MASTERPASS',
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
});
const development = configFor({ NODE_ENV: 'development' });

/**
 * Integrations deferred to go-live (docs/CANLIYA_GECIS.md) keep their development stand-ins, and in production
 * refuse at use instead of pretending to succeed: no fake card, courier, fiscal number or registry approval.
 */
describe('Deferred integrations in production', () => {
  it('refuses card linking and charging until a vault adapter is registered', async () => {
    const registry = new PaymentsRegistry(production);
    await expect(registry.vault.beginLink('user-1', 'https://app.example.com')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(registry.vault.completeLink('user-1', {})).rejects.toBeInstanceOf(ConflictException);
    await expect(
      registry.vaultFor('MOCK').charge({
        token: 't',
        amountMinor: 100,
        currency: 'TRY',
        merchantRef: 'platform',
        orderRef: 'invoice:1:1',
        returnUrl: 'https://app.example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(registry.vault.forget('t')).resolves.toBeUndefined();
    expect(registry.walletCodes()).toEqual([]);
  });

  it('offers no test POS, test courier network or test meal card issuer', () => {
    expect(new PaymentsRegistry(production).gateway('MOCK')).toBeNull();
    expect(new PaymentsRegistry(production).gateway('IYZICO')).not.toBeNull();
    expect(new CourierRegistry(production).get('MOCK')).toBeNull();
    expect(new MealCardsRegistry(production).get('MOCK')).toBeNull();
  });

  it('clears no number on a covered channel and keeps decisions unsynced for the real registry', async () => {
    const registry: ConsentRegistryAdapter = new UnavailableConsentRegistry();
    expect(registry.code).toBe('NONE');
    expect(await registry.allowed('TR', 'SMS', ['+905321112233'])).toEqual(new Set());
    await expect(
      registry.record({
        restaurantId: 'r',
        countryCode: 'TR',
        channel: 'SMS',
        phone: '+905321112233',
        granted: true,
        recipientType: 'INDIVIDUAL',
        at: new Date(),
      }),
    ).rejects.toThrow();
  });

  it('invents no fiscal document number', async () => {
    const fiscal: InvoiceProviderAdapter = new UnavailableInvoiceProvider();
    expect(fiscal.code).toBe('NONE');
    await expect(
      fiscal.issue({
        invoiceId: 'i',
        restaurant: { name: 'R', legalName: null, taxId: null, countryCode: 'TR' },
        currency: 'TRY',
        periodStart: new Date(),
        periodEnd: new Date(),
        orderCount: 1,
        baseMinor: 1,
        commissionMinor: 1,
        vatMinor: 0,
        payoutFeeMinor: 0,
        payoutFeeVatMinor: 0,
        totalMinor: 1,
      }),
    ).rejects.toThrow();
  });

  it('keeps every stand-in working outside production', async () => {
    const registry = new PaymentsRegistry(development);
    expect(registry.gateway('MOCK')).not.toBeNull();
    await expect(registry.vault.completeLink('user-1', {})).resolves.toHaveLength(1);
    expect(new CourierRegistry(development).get('MOCK')).not.toBeNull();
    expect(await new MockConsentRegistry().allowed('TR', 'SMS', ['+905321112233'])).toEqual(new Set(['+905321112233']));
  });
});
