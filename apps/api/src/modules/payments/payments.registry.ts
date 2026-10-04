import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CardVaultAdapter, PaymentGatewayAdapter } from '@resget/shared';
import { CredentialCipher, DEV_CREDENTIAL_KEY, EnvKeyProvider } from '../../common/crypto/credential-cipher';
import { IyzicoGatewayAdapter } from './gateways/iyzico-gateway.adapter';
import { PaytrGatewayAdapter } from './gateways/paytr-gateway.adapter';
import { MockGatewayAdapter } from './mock-gateway.adapter';
import { MockVaultAdapter } from './mock-vault.adapter';

/** Fixed development key; production refuses to boot without CREDENTIAL_ENCRYPTION_KEY (env.ts). */

/**
 * Gateways (where money goes), the card vault (where cards live) and the
 * cipher (how secrets rest). Real adapters are registered here and nowhere
 * else; the order flow only ever sees the interfaces.
 */
@Injectable()
export class PaymentsRegistry {
  private readonly gateways = new Map<string, PaymentGatewayAdapter>();
  readonly vault: CardVaultAdapter;
  readonly cipher: CredentialCipher;

  constructor(private readonly config: ConfigService) {
    this.registerGateway(new MockGatewayAdapter());
    this.registerGateway(new IyzicoGatewayAdapter());
    this.registerGateway(new PaytrGatewayAdapter());
    this.vault = new MockVaultAdapter();
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
