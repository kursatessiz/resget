import { paymentWebhookUrl } from './payments';

describe('payment webhook address', () => {
  it('joins the public API address and the connection without doubled slashes', () => {
    expect(paymentWebhookUrl('https://api.example.com', 'pos', 'c1')).toBe(
      'https://api.example.com/webhooks/payments/pos/c1',
    );
    expect(paymentWebhookUrl('https://api.example.com///', 'platform', 'MOCK')).toBe(
      'https://api.example.com/webhooks/payments/platform/MOCK',
    );
  });

  it('stays fast on a long run of slashes', () => {
    const started = Date.now();
    expect(paymentWebhookUrl(`https://a${'/'.repeat(100_000)}`, 'meal-cards', 'c2')).toBe(
      'https://a/webhooks/payments/meal-cards/c2',
    );
    expect(Date.now() - started).toBeLessThan(500);
  });
});
