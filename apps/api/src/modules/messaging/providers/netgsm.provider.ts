import type { SmsProvider, SmsSendResult } from '../sms.provider';
import { basicAuth, callProvider, digitsOf } from './http';

export interface NetgsmOptions {
  user: string;
  password: string;
  /** Approved sender header (originator), at most 11 characters. */
  header: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface NetgsmSendResponse {
  code?: string;
  jobid?: string;
  description?: string;
}

interface NetgsmBalanceResponse {
  balance?: { amount?: number | string; balance_name?: string }[];
}

/** Netgsm answers 00 (queued), 01 (queued, date adjusted) and 02 (queued, quota) as accepted. */
const NETGSM_ACCEPTED = new Set(['00', '01', '02']);

/**
 * Netgsm REST v2 (docs/MESAJLASMA.md, "Sağlayıcılar"). Transactional
 * messages go without an IYS filter: order updates are service messages to
 * the customer's own order; campaign traffic passes the consent checks of
 * the campaign module before it reaches the engine.
 */
export class NetgsmSmsProvider implements SmsProvider {
  readonly code = 'NETGSM';
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: NetgsmOptions) {
    this.base = (options.baseUrl ?? 'https://api.netgsm.com.tr').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(toE164: string, text: string): Promise<SmsSendResult> {
    const answer = await callProvider<NetgsmSendResponse>(this.fetchImpl, {
      url: `${this.base}/sms/rest/v2/send`,
      headers: { authorization: basicAuth(this.options.user, this.options.password) },
      json: {
        msgheader: this.options.header,
        encoding: 'TR',
        iysfilter: '',
        messages: [{ msg: text, no: digitsOf(toE164) }],
      },
    });
    const code = answer.body?.code ? String(answer.body.code) : null;
    if (!answer.ok || !code || !NETGSM_ACCEPTED.has(code)) return { accepted: false, providerRef: null };
    return { accepted: true, providerRef: answer.body?.jobid ? String(answer.body.jobid) : null };
  }

  /** The SMS credit of the account, summed over the packages the API lists. */
  async balance(): Promise<number | null> {
    const answer = await callProvider<NetgsmBalanceResponse>(this.fetchImpl, {
      url: `${this.base}/balance/list/get`,
      headers: { authorization: basicAuth(this.options.user, this.options.password) },
      json: { stip: 2 },
    });
    const rows = answer.ok ? answer.body?.balance : undefined;
    if (!rows || rows.length === 0) return null;
    const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    return Number.isFinite(total) ? Math.floor(total) : null;
  }
}
