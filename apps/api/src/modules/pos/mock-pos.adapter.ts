import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PosEvent, PosIntegrationAdapter, PosOrderPayload } from '@resget/shared';

/**
 * Deterministic POS for development and tests. A storeId starting with
 * "bad" fails verification and one starting with "down" refuses every push,
 * so both failure paths are testable. Webhooks are signed with HMAC-SHA256
 * of the raw body under the connection's secret (x-mock-signature).
 */
export class MockPosAdapter implements PosIntegrationAdapter {
  readonly code = 'MOCK';

  async verifyCredentials(
    credentials: Record<string, string>,
  ): Promise<{ ok: boolean; label: string; reason?: string }> {
    const storeId = credentials.storeId ?? '';
    if (!storeId || storeId.startsWith('bad')) return { ok: false, label: '', reason: 'Store not found' };
    return { ok: true, label: `Test POS ${storeId}` };
  }

  async pushOrder(credentials: Record<string, string>, payload: PosOrderPayload): Promise<{ externalRef: string }> {
    if ((credentials.storeId ?? '').startsWith('down')) throw new Error('Mock POS unreachable');
    return { externalRef: `mock-pos-${payload.orderId}` };
  }

  parseWebhook(
    credentials: Record<string, string>,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): PosEvent {
    const secret = credentials.secret ?? credentials.storeId ?? 'mock';
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const given = headers['x-mock-signature'] ?? '';
    const a = Buffer.from(given, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Bad webhook signature');
    return JSON.parse(rawBody) as PosEvent;
  }
}
