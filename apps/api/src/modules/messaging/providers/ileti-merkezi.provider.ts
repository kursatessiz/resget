import type { SmsProvider, SmsSendResult } from '../sms.provider';
import { callProvider, digitsOf } from './http';

export interface IletiMerkeziOptions {
  user: string;
  password: string;
  /** Approved sender name, at most 11 characters. */
  sender: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface IletiMerkeziResponse {
  response?: {
    status?: { code?: string | number; message?: string };
    order?: { id?: string | number };
    balance?: { amount?: string | number; sms?: string | number };
  };
}

/**
 * Ileti Merkezi v1 JSON API (docs/MESAJLASMA.md, "Sağlayıcılar"). One
 * message per call; the order id is the provider reference. Balance is the
 * remaining SMS count of the account.
 */
export class IletiMerkeziSmsProvider implements SmsProvider {
  readonly code = 'ILETI_MERKEZI';
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: IletiMerkeziOptions) {
    this.base = (options.baseUrl ?? 'https://api.iletimerkezi.com').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private auth(): { username: string; password: string } {
    return { username: this.options.user, password: this.options.password };
  }

  async send(toE164: string, text: string): Promise<SmsSendResult> {
    const answer = await callProvider<IletiMerkeziResponse>(this.fetchImpl, {
      url: `${this.base}/v1/send-sms/json`,
      json: {
        request: {
          authentication: this.auth(),
          order: {
            sender: this.options.sender,
            sendDateTime: [],
            message: { text, receipents: { number: [digitsOf(toE164)] } },
          },
        },
      },
    });
    const status = String(answer.body?.response?.status?.code ?? '');
    if (!answer.ok || status !== '200') return { accepted: false, providerRef: null };
    const id = answer.body?.response?.order?.id;
    return { accepted: true, providerRef: id !== undefined ? String(id) : null };
  }

  async balance(): Promise<number | null> {
    const answer = await callProvider<IletiMerkeziResponse>(this.fetchImpl, {
      url: `${this.base}/v1/get-balance/json`,
      json: { request: { authentication: this.auth() } },
    });
    const sms = answer.ok ? answer.body?.response?.balance?.sms : undefined;
    const value = Number(sms);
    return sms !== undefined && Number.isFinite(value) ? Math.floor(value) : null;
  }
}
