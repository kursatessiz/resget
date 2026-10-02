import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { GatewayWebhookEvent, HostedCheckoutSession, PaymentGatewayAdapter } from '@resget/shared';

/**
 * Deterministic gateway for development and tests. A credential set whose
 * merchantId starts with "bad" fails verification, so the connection flow's
 * failure path is testable; everything else is accepted.
 */
export class MockGatewayAdapter implements PaymentGatewayAdapter {
  readonly code = 'MOCK';

  async verifyCredentials(
    credentials: Record<string, string>,
  ): Promise<{ ok: boolean; label: string; reason?: string }> {
    const merchantId = credentials.merchantId ?? '';
    if (merchantId.startsWith('bad')) return { ok: false, label: '', reason: 'Merchant not found' };
    return { ok: true, label: `MOCK ****${merchantId.slice(-4)}` };
  }

  async createHostedCheckout(
    _credentials: Record<string, string>,
    params: { orderRef: string; amountMinor: number; currency: string; returnUrl: string; customerPhone: string },
  ): Promise<HostedCheckoutSession> {
    const sessionId = randomUUID();
    return {
      providerCode: this.code,
      sessionId,
      redirectUrl: `${params.returnUrl}?mockSession=${sessionId}`,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
  }

  async refund(): Promise<{ ok: boolean; providerRef: string | null }> {
    return { ok: true, providerRef: `mock-refund-${randomUUID()}` };
  }

  parseWebhook(
    credentials: Record<string, string>,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): GatewayWebhookEvent {
    const secret = credentials.merchantKey ?? credentials.merchantId ?? 'mock';
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const given = headers['x-mock-signature'] ?? '';
    const a = Buffer.from(given, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Bad webhook signature');
    return JSON.parse(rawBody) as GatewayWebhookEvent;
  }
}
