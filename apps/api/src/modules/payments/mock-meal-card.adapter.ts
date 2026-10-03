import type { GatewayWebhookEvent, MealCardAdapter } from '@resget/shared';
import { MockGatewayAdapter } from './mock-gateway.adapter';

/**
 * Development issuer: same deterministic behaviour as the mock gateway
 * (merchantId starting with "bad" fails verification, HMAC-signed webhooks
 * with the apiSecret or merchantId as key).
 */
export class MockMealCardAdapter extends MockGatewayAdapter implements MealCardAdapter {
  override readonly code = 'MOCK' as const;

  override async verifyCredentials(
    credentials: Record<string, string>,
  ): Promise<{ ok: boolean; label: string; reason?: string }> {
    const merchantId = credentials.merchantId ?? '';
    if (merchantId.startsWith('bad')) return { ok: false, label: '', reason: 'Member merchant not found' };
    return { ok: true, label: `Test kart ****${merchantId.slice(-4)}` };
  }

  /** Issuers sign with their API secret; the mock falls back to the merchant id when none was given. */
  override parseWebhook(
    credentials: Record<string, string>,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): GatewayWebhookEvent {
    const secret = credentials.apiSecret ?? credentials.merchantId ?? 'mock';
    return super.parseWebhook({ merchantKey: secret }, rawBody, headers);
  }
}
