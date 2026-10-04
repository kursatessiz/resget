import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  GatewayWebhookEvent,
  HostedCheckoutParams,
  HostedCheckoutSession,
  PaymentGatewayAdapter,
} from '@resget/shared';
import { majorString, parseForm, postForm } from './gateway-http';

export interface PaytrAdapterOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
}

interface PaytrTokenResponse {
  status?: string;
  token?: string;
  reason?: string;
}

interface PaytrRefundResponse {
  status?: string;
  err_msg?: string;
  return_amount?: string | number;
}

/** PayTR's currency codes for the ISO codes it accepts. */
const PAYTR_CURRENCIES: Record<string, string> = { TRY: 'TL', EUR: 'EUR', USD: 'USD', GBP: 'GBP', RUB: 'RUB' };
const DEFAULT_BASE_URL = 'https://www.paytr.com';

/**
 * PayTR iframe API (docs/ODEME.md, section 2). A signed token request
 * returns the iframe to show; PayTR posts the result to the notification
 * URL set in the merchant panel (the connection's webhook URL) with a hash
 * over the order id, salt, status and amount, and expects the plain text
 * "OK" back, otherwise it keeps retrying. Amounts travel in kurus.
 */
export class PaytrGatewayAdapter implements PaymentGatewayAdapter {
  readonly code = 'PAYTR';
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;
  private readonly now: () => Date;

  constructor(options: PaytrAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.now = options.now ?? (() => new Date());
  }

  private sign(credentials: Record<string, string>, data: string): string {
    return createHmac('sha256', credentials.merchantKey ?? '')
      .update(data + (credentials.merchantSalt ?? ''))
      .digest('base64');
  }

  /** PayTR allows letters and digits only in merchant_oid; the order id travels without its dashes. */
  static merchantOid(orderRef: string): string {
    return orderRef.replace(/-/g, '');
  }

  static orderRefOf(merchantOid: string): string {
    const m = /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i.exec(merchantOid);
    return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}` : merchantOid;
  }

  tokenFields(
    credentials: Record<string, string>,
    params: HostedCheckoutParams,
    testMode = '0',
  ): Record<string, string> {
    const currency = PAYTR_CURRENCIES[params.currency];
    if (!currency) throw new Error(`PayTR does not accept ${params.currency}`);
    const merchantOid = PaytrGatewayAdapter.merchantOid(params.orderRef);
    const phoneDigits = params.customerPhone.replace(/\D/g, '');
    const email = `${phoneDigits || merchantOid}@musteri.resget.invalid`;
    const userIp = params.customerIp || '0.0.0.0';
    const amount = String(params.amountMinor);
    const basket = Buffer.from(
      JSON.stringify([[`Siparis ${params.orderRef.slice(-6).toUpperCase()}`, majorString(params.amountMinor), 1]]),
      'utf8',
    ).toString('base64');
    const noInstallment = '1';
    const maxInstallment = '0';
    const hashStr = `${credentials.merchantId}${userIp}${merchantOid}${email}${amount}${basket}${noInstallment}${maxInstallment}${currency}${testMode}`;
    return {
      merchant_id: credentials.merchantId ?? '',
      user_ip: userIp,
      merchant_oid: merchantOid,
      email,
      payment_amount: amount,
      paytr_token: this.sign(credentials, hashStr),
      user_basket: basket,
      debug_on: '0',
      no_installment: noInstallment,
      max_installment: maxInstallment,
      user_name: params.customerName?.trim() || 'Musteri',
      user_address: 'Siparis adresi restoranda',
      user_phone: params.customerPhone || phoneDigits || '-',
      merchant_ok_url: params.returnUrl,
      merchant_fail_url: params.returnUrl,
      timeout_limit: '30',
      currency,
      test_mode: testMode,
      lang: 'tr',
    };
  }

  /** PayTR has no credential ping; a token request in test mode proves the merchant id, key and salt agree. */
  async verifyCredentials(
    credentials: Record<string, string>,
  ): Promise<{ ok: boolean; label: string; reason?: string }> {
    const probe: HostedCheckoutParams = {
      orderRef: `verify${Date.now()}`,
      amountMinor: 100,
      currency: 'TRY',
      returnUrl: 'https://resget.invalid/verify',
      customerPhone: '',
    };
    const answer = await postForm<PaytrTokenResponse>(
      this.fetchImpl,
      `${this.base}/odeme/api/get-token`,
      this.tokenFields(credentials, probe, '1'),
    );
    if (answer.body?.status !== 'success') return { ok: false, label: '', reason: answer.body?.reason ?? 'Rejected' };
    return { ok: true, label: `PayTR ****${(credentials.merchantId ?? '').slice(-4)}` };
  }

  async createHostedCheckout(
    credentials: Record<string, string>,
    params: HostedCheckoutParams,
  ): Promise<HostedCheckoutSession> {
    const answer = await postForm<PaytrTokenResponse>(
      this.fetchImpl,
      `${this.base}/odeme/api/get-token`,
      this.tokenFields(credentials, params),
    );
    if (answer.body?.status !== 'success' || !answer.body.token) {
      throw new Error(`PayTR refused the checkout: ${answer.body?.reason ?? 'no answer'}`);
    }
    return {
      providerCode: this.code,
      sessionId: answer.body.token,
      redirectUrl: `${this.base}/odeme/guvenli/${answer.body.token}`,
      expiresAt: new Date(this.now().getTime() + 30 * 60_000).toISOString(),
    };
  }

  async refund(
    credentials: Record<string, string>,
    providerRef: string,
    amountMinor: number,
  ): Promise<{ ok: boolean; providerRef: string | null }> {
    const returnAmount = majorString(amountMinor);
    const answer = await postForm<PaytrRefundResponse>(this.fetchImpl, `${this.base}/odeme/iade`, {
      merchant_id: credentials.merchantId ?? '',
      merchant_oid: providerRef,
      return_amount: returnAmount,
      paytr_token: this.sign(credentials, `${credentials.merchantId}${providerRef}${returnAmount}`),
    });
    if (answer.body?.status !== 'success') return { ok: false, providerRef: null };
    return { ok: true, providerRef };
  }

  parseWebhook(credentials: Record<string, string>, rawBody: string): GatewayWebhookEvent {
    const form = parseForm(rawBody);
    const { merchant_oid: merchantOid = '', status = '', total_amount: totalAmount = '', hash = '' } = form;
    // The hash covers merchant_oid + merchant_salt + status + total_amount in that order.
    const canonical = createHmac('sha256', credentials.merchantKey ?? '')
      .update(`${merchantOid}${credentials.merchantSalt ?? ''}${status}${totalAmount}`)
      .digest('base64');
    const a = Buffer.from(hash, 'utf8');
    const b = Buffer.from(canonical, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Bad PayTR hash');
    const amountMinor = Number.parseInt(totalAmount, 10);
    return {
      providerRef: merchantOid,
      orderRef: PaytrGatewayAdapter.orderRefOf(merchantOid),
      status: status === 'success' ? 'CAPTURED' : 'FAILED',
      amountMinor: Number.isFinite(amountMinor) ? amountMinor : 0,
      currency: Object.entries(PAYTR_CURRENCIES).find(([, code]) => code === (form.currency ?? 'TL'))?.[0] ?? '',
      pspFeeMinor: null,
      occurredAt: this.now().toISOString(),
      ack: { contentType: 'text/plain', body: 'OK' },
    };
  }
}
