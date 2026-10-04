import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CardVaultAdapter, PaymentGatewayAdapter } from '@resget/shared';
import { CredentialCipher, DEV_CREDENTIAL_KEY, EnvKeyProvider } from '../../common/crypto/credential-cipher';
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

  constructor(config: ConfigService) {
    this.registerGateway(new MockGatewayAdapter());
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
}
