import { createHmac } from 'node:crypto';
import { IyzicoGatewayAdapter } from './iyzico-gateway.adapter';
import { PaytrGatewayAdapter } from './paytr-gateway.adapter';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function fakeFetch(answers: unknown[]): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers as Record<string, string>) ?? {},
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const body = answers[Math.min(i, answers.length - 1)];
    i += 1;
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const ORDER = '7b1a2f3c-4d5e-4f60-8a9b-0c1d2e3f4a5b';
const NOW = new Date('2026-10-04T10:00:00.000Z');

describe('iyzico gateway adapter', () => {
  const credentials = { apiKey: 'api-key', secretKey: 'secret-key', baseUrl: 'https://sandbox.iyzico.test/' };

  it('signs requests the IYZWSv2 way and opens a checkout form with the connection webhook as callback', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 'success', token: 'tok-1', paymentPageUrl: 'https://pay.iyzico.test/tok-1', tokenExpireTime: 1800 },
    ]);
    const adapter = new IyzicoGatewayAdapter({ fetchImpl, randomKey: () => 'rnd123', now: () => NOW });
    const session = await adapter.createHostedCheckout(credentials, {
      orderRef: ORDER,
      amountMinor: 42050,
      currency: 'TRY',
      returnUrl: 'https://web.test/t/abc',
      customerPhone: '+905321234567',
      customerName: 'Ayse Yilmaz',
      customerIp: '10.0.0.1',
      notifyUrl: 'https://api.test/webhooks/payments/pos/conn-1',
    });
    expect(session).toEqual({
      providerCode: 'IYZICO',
      sessionId: 'tok-1',
      redirectUrl: 'https://pay.iyzico.test/tok-1',
      expiresAt: new Date(NOW.getTime() + 1800_000).toISOString(),
    });
    const call = calls[0];
    expect(call.url).toBe('https://sandbox.iyzico.test/payment/iyzipos/checkoutform/initialize/auth/ecom');
    const body = JSON.parse(call.body) as {
      price: string;
      paidPrice: string;
      currency: string;
      callbackUrl: string;
      buyer: { name: string; surname: string; ip: string };
      basketItems: { price: string }[];
    };
    expect(body.price).toBe('420.50');
    expect(body.paidPrice).toBe('420.50');
    expect(body.currency).toBe('TRY');
    expect(body.callbackUrl).toBe(
      `https://api.test/webhooks/payments/pos/conn-1?return=${encodeURIComponent('https://web.test/t/abc')}`,
    );
    expect(body.buyer).toMatchObject({ name: 'Ayse', surname: 'Yilmaz', ip: '10.0.0.1' });
    expect(body.basketItems[0].price).toBe('420.50');
    // Authorization: base64 of apiKey, random key and HMAC-SHA256(secret, rnd + path + body).
    const signature = createHmac('sha256', 'secret-key')
      .update('rnd123/payment/iyzipos/checkoutform/initialize/auth/ecom' + call.body)
      .digest('hex');
    const expected = `IYZWSv2 ${Buffer.from(`apiKey:api-key&randomKey:rnd123&signature:${signature}`).toString('base64')}`;
    expect(call.headers.authorization).toBe(expected);
    expect(call.headers['x-iyzi-rnd']).toBe('rnd123');
  });

  it('turns the browser callback into a read-back of the payment and sends the customer on', async () => {
    const detail = {
      status: 'success',
      paymentStatus: 'SUCCESS',
      paymentId: '99',
      paidPrice: '420.50',
      currency: 'TRY',
      basketId: ORDER,
      iyziCommissionFee: '0.25',
      iyziCommissionRateAmount: '8.41',
      itemTransactions: [{ paymentTransactionId: 'tx-1' }],
    };
    const { fetchImpl, calls } = fakeFetch([detail]);
    const adapter = new IyzicoGatewayAdapter({ fetchImpl, randomKey: () => 'r', now: () => NOW });
    const event = await adapter.parseWebhook(credentials, 'token=tok-1', {}, { return: 'https://web.test/t/abc' });
    expect(calls[0].url).toBe('https://sandbox.iyzico.test/payment/iyzipos/checkoutform/auth/ecom/detail');
    expect(JSON.parse(calls[0].body)).toEqual({ locale: 'tr', token: 'tok-1' });
    expect(event).toEqual({
      providerRef: 'tx-1',
      orderRef: ORDER,
      status: 'CAPTURED',
      amountMinor: 42050,
      currency: 'TRY',
      pspFeeMinor: 866,
      occurredAt: NOW.toISOString(),
      browserRedirectUrl: 'https://web.test/t/abc',
    });
  });

  it('verifies the V3 signature of merchant notifications and refuses a bad one', async () => {
    const body = {
      iyziEventType: 'CHECKOUT_FORM_AUTH',
      paymentId: 99,
      paymentConversationId: ORDER,
      status: 'FAILURE',
      token: 'tok-9',
    };
    const signature = createHmac('sha256', 'secret-key')
      .update(`secret-keyCHECKOUT_FORM_AUTH99${ORDER}FAILURE`)
      .digest('hex');
    const { fetchImpl } = fakeFetch([
      {
        status: 'success',
        paymentStatus: 'FAILURE',
        paymentId: '99',
        paidPrice: '420.50',
        currency: 'TRY',
        basketId: ORDER,
      },
    ]);
    const adapter = new IyzicoGatewayAdapter({ fetchImpl, randomKey: () => 'r', now: () => NOW });
    const event = await adapter.parseWebhook(credentials, JSON.stringify(body), { 'x-iyz-signature-v3': signature });
    expect(event.status).toBe('FAILED');
    expect(event.browserRedirectUrl).toBeUndefined();
    await expect(
      adapter.parseWebhook(credentials, JSON.stringify(body), { 'x-iyz-signature-v3': 'deadbeef' }),
    ).rejects.toThrow('Bad iyzico signature');
  });
});

describe('PayTR gateway adapter', () => {
  const credentials = { merchantId: '123456', merchantKey: 'merchant-key', merchantSalt: 'merchant-salt' };

  it('requests an iframe token with the documented hash and returns the iframe URL', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 'success', token: 'ptoken' }]);
    const adapter = new PaytrGatewayAdapter({ fetchImpl, baseUrl: 'https://paytr.test', now: () => NOW });
    const session = await adapter.createHostedCheckout(credentials, {
      orderRef: ORDER,
      amountMinor: 42050,
      currency: 'TRY',
      returnUrl: 'https://web.test/t/abc',
      customerPhone: '+905321234567',
      customerIp: '10.0.0.1',
    });
    expect(session.redirectUrl).toBe('https://paytr.test/odeme/guvenli/ptoken');
    expect(session.sessionId).toBe('ptoken');
    expect(calls[0].url).toBe('https://paytr.test/odeme/api/get-token');
    const fields = Object.fromEntries(new URLSearchParams(calls[0].body));
    expect(fields.merchant_oid).toBe(ORDER.replace(/-/g, ''));
    expect(fields.payment_amount).toBe('42050');
    expect(fields.currency).toBe('TL');
    expect(fields.test_mode).toBe('0');
    const hashStr = `${fields.merchant_id}${fields.user_ip}${fields.merchant_oid}${fields.email}${fields.payment_amount}${fields.user_basket}${fields.no_installment}${fields.max_installment}${fields.currency}${fields.test_mode}`;
    const expected = createHmac('sha256', 'merchant-key').update(`${hashStr}merchant-salt`).digest('base64');
    expect(fields.paytr_token).toBe(expected);
  });

  it('accepts a correctly hashed callback, answers OK, restores the order id and refuses a bad hash', () => {
    const adapter = new PaytrGatewayAdapter({ now: () => NOW });
    const oid = ORDER.replace(/-/g, '');
    const hash = createHmac('sha256', 'merchant-key').update(`${oid}merchant-saltsuccess42050`).digest('base64');
    const raw = new URLSearchParams({
      merchant_oid: oid,
      status: 'success',
      total_amount: '42050',
      hash,
      currency: 'TL',
    }).toString();
    const event = adapter.parseWebhook(credentials, raw);
    expect(event).toEqual({
      providerRef: oid,
      orderRef: ORDER,
      status: 'CAPTURED',
      amountMinor: 42050,
      currency: 'TRY',
      pspFeeMinor: null,
      occurredAt: NOW.toISOString(),
      ack: { contentType: 'text/plain', body: 'OK' },
    });
    const tampered = new URLSearchParams({ merchant_oid: oid, status: 'success', total_amount: '1', hash }).toString();
    expect(() => adapter.parseWebhook(credentials, tampered)).toThrow('Bad PayTR hash');
  });

  it('refuses a currency PayTR does not take', async () => {
    const adapter = new PaytrGatewayAdapter({ fetchImpl: fakeFetch([{}]).fetchImpl });
    await expect(
      adapter.createHostedCheckout(credentials, {
        orderRef: ORDER,
        amountMinor: 100,
        currency: 'JPY',
        returnUrl: 'https://web.test',
        customerPhone: '',
      }),
    ).rejects.toThrow('PayTR does not accept JPY');
  });
});
