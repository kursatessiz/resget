import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  GatewayWebhookEvent,
  HostedCheckoutParams,
  HostedCheckoutSession,
  PaymentGatewayAdapter,
} from '@resget/shared';
import { majorString, minorOf, parseForm, postJson } from './gateway-http';

export interface IyzicoAdapterOptions {
  fetchImpl?: typeof fetch;
  /** Injected in tests so the request signature is reproducible. */
  randomKey?: () => string;
  now?: () => Date;
}

interface IyzicoInitializeResponse {
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  token?: string;
  paymentPageUrl?: string;
  tokenExpireTime?: number;
}

interface IyzicoPaymentDetail {
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  paymentStatus?: string;
  paymentId?: string;
  paidPrice?: string | number;
  price?: string | number;
  currency?: string;
  basketId?: string;
  conversationId?: string;
  iyziCommissionFee?: string | number;
  iyziCommissionRateAmount?: string | number;
  itemTransactions?: { paymentTransactionId?: string }[];
}

interface IyzicoRefundResponse {
  status?: string;
  paymentTransactionId?: string;
  paymentId?: string;
}

interface IyzicoWebhookBody {
  iyziEventType?: string;
  paymentId?: string | number;
  paymentConversationId?: string;
  status?: string;
  token?: string;
}

const DEFAULT_BASE_URL = 'https://api.iyzipay.com';
/**
 * The only hosts a restaurant's iyzico credentials are sent to: live and sandbox. A free-form base URL would let
 * a restaurant point the API at an internal address with its own request (server-side request forgery).
 */
export const IYZICO_BASE_URLS: readonly string[] = [DEFAULT_BASE_URL, 'https://sandbox-api.iyzipay.com'];
const INITIALIZE_PATH = '/payment/iyzipos/checkoutform/initialize/auth/ecom';
const CHECKOUT_DETAIL_PATH = '/payment/iyzipos/checkoutform/auth/ecom/detail';
const PAYMENT_DETAIL_PATH = '/payment/detail';
const REFUND_PATH = '/payment/refund';
const BIN_CHECK_PATH = '/payment/bin/check';

/**
 * iyzico checkout form (docs/ODEME.md, section 2): the card is typed on
 * iyzico's hosted page with 3-D Secure, the platform only ever sees a token.
 * Both ways iyzico reports a result land on the connection's webhook URL:
 * the customer's browser (POST with the form token, redirected on to the
 * order page afterwards) and the merchant notification (JSON, signed with
 * the V3 signature). Either one is only a trigger; the amount and status
 * are read back from iyzico before anything is recorded.
 */
export class IyzicoGatewayAdapter implements PaymentGatewayAdapter {
  readonly code = 'IYZICO';
  private readonly fetchImpl: typeof fetch;
  private readonly randomKey: () => string;
  private readonly now: () => Date;

  constructor(options: IyzicoAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.randomKey = options.randomKey ?? (() => `${Date.now()}${randomBytes(4).toString('hex')}`);
    this.now = options.now ?? (() => new Date());
  }

  /** iyzico's HMAC-SHA256 request authentication (IYZWSv2). */
  authorization(credentials: Record<string, string>, uriPath: string, body: string, randomKey: string): string {
    const signature = createHmac('sha256', credentials.secretKey ?? '')
      .update(randomKey + uriPath + body)
      .digest('hex');
    const raw = `apiKey:${credentials.apiKey ?? ''}&randomKey:${randomKey}&signature:${signature}`;
    return `IYZWSv2 ${Buffer.from(raw, 'utf8').toString('base64')}`;
  }

  private baseUrl(credentials: Record<string, string>): string {
    const url = (credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    if (!IYZICO_BASE_URLS.includes(url)) throw new Error('iyzico base URL is not an iyzico host');
    return url;
  }

  private async call<T>(credentials: Record<string, string>, path: string, payload: unknown): Promise<T | null> {
    const body = JSON.stringify(payload);
    const rnd = this.randomKey();
    const answer = await postJson<T>(
      this.fetchImpl,
      `${this.baseUrl(credentials)}${path}`,
      { authorization: this.authorization(credentials, path, body, rnd), 'x-iyzi-rnd': rnd },
      body,
    );
    return answer.body;
  }

  async verifyCredentials(
    credentials: Record<string, string>,
  ): Promise<{ ok: boolean; label: string; reason?: string }> {
    const url = (credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    if (!IYZICO_BASE_URLS.includes(url)) return { ok: false, label: '', reason: 'Unknown iyzico address' };
    const answer = await this.call<{ status?: string; errorMessage?: string }>(credentials, BIN_CHECK_PATH, {
      locale: 'tr',
      binNumber: '554960',
    });
    if (answer?.status !== 'success') return { ok: false, label: '', reason: answer?.errorMessage ?? 'Rejected' };
    return { ok: true, label: `iyzico ****${(credentials.apiKey ?? '').slice(-4)}` };
  }

  async createHostedCheckout(
    credentials: Record<string, string>,
    params: HostedCheckoutParams,
  ): Promise<HostedCheckoutSession> {
    if (!params.notifyUrl) throw new Error('iyzico needs the connection webhook URL as callback');
    const price = majorString(params.amountMinor);
    const callbackUrl = `${params.notifyUrl}${params.notifyUrl.includes('?') ? '&' : '?'}return=${encodeURIComponent(params.returnUrl)}`;
    const phoneDigits = params.customerPhone.replace(/\D/g, '');
    const [name, ...rest] = (params.customerName ?? '').trim().split(/\s+/).filter(Boolean);
    // iyzico requires a buyer and addresses even for a takeaway meal; the order carries what is known, the rest is neutral.
    const person = {
      id: phoneDigits || params.orderRef,
      name: name ?? 'Musteri',
      surname: rest.join(' ') || '-',
      gsmNumber: params.customerPhone || undefined,
      email: `${phoneDigits || params.orderRef.replace(/-/g, '')}@musteri.resget.invalid`,
      identityNumber: '11111111111',
      registrationAddress: 'Siparis adresi restoranda',
      ip: params.customerIp || '0.0.0.0',
      city: 'Istanbul',
      country: 'Turkey',
    };
    const address = {
      contactName: `${person.name} ${person.surname}`,
      city: person.city,
      country: person.country,
      address: person.registrationAddress,
    };
    const answer = await this.call<IyzicoInitializeResponse>(credentials, INITIALIZE_PATH, {
      locale: 'tr',
      conversationId: params.orderRef,
      price,
      paidPrice: price,
      currency: params.currency,
      basketId: params.orderRef,
      paymentGroup: 'PRODUCT',
      callbackUrl,
      enabledInstallments: [1],
      buyer: person,
      shippingAddress: address,
      billingAddress: address,
      basketItems: [
        {
          id: params.orderRef,
          name: `Siparis ${params.orderRef.slice(-6).toUpperCase()}`,
          category1: 'Yemek',
          itemType: 'PHYSICAL',
          price,
        },
      ],
    });
    if (answer?.status !== 'success' || !answer.token || !answer.paymentPageUrl) {
      throw new Error(`iyzico refused the checkout: ${answer?.errorMessage ?? answer?.errorCode ?? 'no answer'}`);
    }
    const ttlSeconds = typeof answer.tokenExpireTime === 'number' ? answer.tokenExpireTime : 1800;
    return {
      providerCode: this.code,
      sessionId: answer.token,
      redirectUrl: answer.paymentPageUrl,
      expiresAt: new Date(this.now().getTime() + ttlSeconds * 1000).toISOString(),
    };
  }

  async refund(
    credentials: Record<string, string>,
    providerRef: string,
    amountMinor: number,
  ): Promise<{ ok: boolean; providerRef: string | null }> {
    const answer = await this.call<IyzicoRefundResponse>(credentials, REFUND_PATH, {
      locale: 'tr',
      paymentTransactionId: providerRef,
      price: majorString(amountMinor),
      ip: '0.0.0.0',
    });
    if (answer?.status !== 'success') return { ok: false, providerRef: null };
    return { ok: true, providerRef: answer.paymentTransactionId ?? providerRef };
  }

  /** Browser callback (form token) or merchant notification (signed JSON); both end in a read-back of the payment. */
  async parseWebhook(
    credentials: Record<string, string>,
    rawBody: string,
    headers: Record<string, string | undefined>,
    query: Record<string, string | undefined> = {},
  ): Promise<GatewayWebhookEvent> {
    const trimmed = rawBody.trim();
    if (trimmed.startsWith('{')) {
      const body = JSON.parse(trimmed) as IyzicoWebhookBody;
      this.assertSignature(credentials, body, headers['x-iyz-signature-v3'] ?? '');
      const detail = body.token
        ? await this.call<IyzicoPaymentDetail>(credentials, CHECKOUT_DETAIL_PATH, { locale: 'tr', token: body.token })
        : await this.call<IyzicoPaymentDetail>(credentials, PAYMENT_DETAIL_PATH, {
            locale: 'tr',
            paymentId: body.paymentId !== undefined ? String(body.paymentId) : undefined,
            paymentConversationId: body.paymentConversationId,
          });
      return this.eventFrom(detail);
    }
    const form = parseForm(trimmed);
    if (!form.token) throw new Error('No checkout token in callback');
    const detail = await this.call<IyzicoPaymentDetail>(credentials, CHECKOUT_DETAIL_PATH, {
      locale: 'tr',
      token: form.token,
    });
    const event = this.eventFrom(detail);
    const back = query.return;
    if (back && /^https?:\/\//.test(back)) event.browserRedirectUrl = back;
    return event;
  }

  /** V3 signature: HMAC-SHA256 over secretKey + eventType + paymentId + conversationId + status, keyed with the secret. */
  private assertSignature(credentials: Record<string, string>, body: IyzicoWebhookBody, given: string): void {
    const secret = credentials.secretKey ?? '';
    const payload = `${secret}${body.iyziEventType ?? ''}${body.paymentId ?? ''}${body.paymentConversationId ?? ''}${body.status ?? ''}`;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const a = Buffer.from(given.toLowerCase(), 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Bad iyzico signature');
  }

  private eventFrom(detail: IyzicoPaymentDetail | null): GatewayWebhookEvent {
    if (!detail || detail.status !== 'success') {
      throw new Error(`iyzico payment could not be read: ${detail?.errorMessage ?? detail?.errorCode ?? 'no answer'}`);
    }
    const orderRef = detail.basketId ?? detail.conversationId;
    if (!orderRef) throw new Error('iyzico payment carries no order reference');
    const amountMinor = minorOf(detail.paidPrice ?? detail.price) ?? 0;
    const fee = (minorOf(detail.iyziCommissionFee) ?? 0) + (minorOf(detail.iyziCommissionRateAmount) ?? 0);
    const transactionId = detail.itemTransactions?.[0]?.paymentTransactionId ?? detail.paymentId ?? '';
    return {
      providerRef: String(transactionId),
      orderRef,
      status: detail.paymentStatus === 'SUCCESS' ? 'CAPTURED' : 'FAILED',
      amountMinor,
      currency: detail.currency ?? '',
      pspFeeMinor: fee > 0 ? fee : null,
      occurredAt: this.now().toISOString(),
    };
  }
}
