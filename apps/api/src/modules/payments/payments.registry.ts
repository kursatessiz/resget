import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WALLET_PROVIDERS } from '@resget/shared';
import type {
  CardVaultAdapter,
  CardVaultProviderCode,
  PaymentGatewayAdapter,
  WalletProviderCode,
} from '@resget/shared';
import { CredentialCipher, DEV_CREDENTIAL_KEY, EnvKeyProvider } from '../../common/crypto/credential-cipher';
import { IyzicoGatewayAdapter } from './gateways/iyzico-gateway.adapter';
import { PaytrGatewayAdapter } from './gateways/paytr-gateway.adapter';
import { MockGatewayAdapter } from './mock-gateway.adapter';
import { MockVaultAdapter } from './mock-vault.adapter';
import { UnavailableVaultAdapter } from './unavailable-vault.adapter';

/**
 * Gateways (where money goes), the card vault (where cards live) and the
 * cipher (how secrets rest). Real adapters are registered here and nowhere
 * else; the order flow only ever sees the interfaces.
 */
@Injectable()
export class PaymentsRegistry {
  private readonly gateways = new Map<string, PaymentGatewayAdapter>();
  /** Platform wallets by code (docs/CUZDAN.md); a real adapter is registered here once its merchant contract exists. */
  private readonly wallets = new Map<WalletProviderCode, CardVaultAdapter>();
  readonly vault: CardVaultAdapter;
  readonly cipher: CredentialCipher;

  constructor(private readonly config: ConfigService) {
    const production = config.get<string>('NODE_ENV') === 'production';
    // The test POS takes no money, so production never offers it to a restaurant (the panel hides it too).
    if (!production) this.registerGateway(new MockGatewayAdapter());
    this.registerGateway(new IyzicoGatewayAdapter());
    this.registerGateway(new PaytrGatewayAdapter());
    // No real vault or wallet adapter ships yet. Development and tests get stand-ins so the flow runs end to end;
    // production refuses card linking and charging until the contracted adapter is registered here for
    // CARD_VAULT_PROVIDER (docs/ODEME.md 3), so a fake card can never mark an invoice paid.
    this.vault = production
      ? new UnavailableVaultAdapter(config.get<CardVaultProviderCode>('CARD_VAULT_PROVIDER') ?? 'MOCK')
      : new MockVaultAdapter();
    if (!production) {
      for (const code of WALLET_PROVIDERS) this.wallets.set(code, new MockVaultAdapter(code));
    }
    // Production refuses to boot without CREDENTIAL_ENCRYPTION_KEY (env.ts); the fixed key is for development.
    this.cipher = new CredentialCipher(
      new EnvKeyProvider(config.get<string>('CREDENTIAL_ENCRYPTION_KEY') ?? DEV_CREDENTIAL_KEY),
    );
  }

  registerGateway(adapter: PaymentGatewayAdapter): void {
    this.gateways.set(adapter.code, adapter);
  }

  gateway(code: string): PaymentGatewayAdapter | null {
    return this.gateways.get(code) ?? null;
  }

  wallet(code: WalletProviderCode): CardVaultAdapter | null {
    return this.wallets.get(code) ?? null;
  }

  walletCodes(): WalletProviderCode[] {
    return WALLET_PROVIDERS.filter((code) => this.wallets.has(code));
  }

  /** The vault that holds a saved card's token: its wallet, or the default vault of billing cards. */
  vaultFor(provider: string): CardVaultAdapter {
    return this.wallets.get(provider as WalletProviderCode) ?? this.vault;
  }

  /** The platform's own merchant at a gateway (PLATFORM_PSP restaurants), from the environment; empty for the mock. */
  platformCredentials(code: string): Record<string, string> {
    const get = (key: string) => this.config.get<string>(key) ?? '';
    switch (code) {
      case 'IYZICO':
        return { apiKey: get('IYZICO_API_KEY'), secretKey: get('IYZICO_SECRET_KEY'), baseUrl: get('IYZICO_BASE_URL') };
      case 'PAYTR':
        return {
          merchantId: get('PAYTR_MERCHANT_ID'),
          merchantKey: get('PAYTR_MERCHANT_KEY'),
          merchantSalt: get('PAYTR_MERCHANT_SALT'),
        };
      default:
        return {};
    }
  }
}
